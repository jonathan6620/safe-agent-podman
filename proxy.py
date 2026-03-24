"""
Host-side auth proxy for Claude Code containers.

Sits between the container and api.anthropic.com:
- Injects authentication from the host's Claude OAuth session
- Logs all API calls (model, tokens, cost estimate)
- Container never sees credentials

Usage:
    python proxy.py [--port 8080] [--log-dir ./logs]
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ANTHROPIC_API = "https://api.anthropic.com"
CREDENTIALS_PATH = Path.home() / ".claude" / ".credentials.json"
logger = logging.getLogger("claude-proxy")


def _read_oauth_token() -> str | None:
    """Read the OAuth access token from Claude Code's credentials file."""
    try:
        data = json.loads(CREDENTIALS_PATH.read_text())
        token = data.get("claudeAiOauth", {}).get("accessToken")
        if token:
            return token
    except (FileNotFoundError, json.JSONDecodeError, KeyError) as e:
        logger.debug("Could not read OAuth token from %s: %s", CREDENTIALS_PATH, e)
    return None


def get_auth_token() -> str:
    """Get authentication token. Prefers Claude OAuth session, falls back to API key."""
    # 1. Explicit env override
    token = os.environ.get("ANTHROPIC_API_KEY")
    if token:
        return token

    # 2. Claude Code's OAuth session (default)
    token = _read_oauth_token()
    if token:
        return token

    # 3. Key helper script
    helper = os.environ.get("CLAUDE_PROXY_KEY_HELPER")
    if helper:
        result = subprocess.run(
            helper, shell=True, capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            return result.stdout.strip()
        logger.error("Key helper failed: %s", result.stderr)

    raise RuntimeError(
        "No auth found. Log in with 'claude' first, or set ANTHROPIC_API_KEY."
    )


class ProxyHandler(BaseHTTPRequestHandler):
    log_dir: Path | None = None
    _call_count: int = 0

    def do_POST(self) -> None:
        self._proxy("POST")

    def do_GET(self) -> None:
        self._proxy("GET")

    def do_OPTIONS(self) -> None:
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def _proxy(self, method: str) -> None:
        start = time.monotonic()
        ProxyHandler._call_count += 1
        call_id = ProxyHandler._call_count

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        # Log the request
        request_data = None
        if body:
            try:
                request_data = json.loads(body)
            except json.JSONDecodeError:
                request_data = {"raw_bytes": len(body)}

        model: str = "unknown"
        if isinstance(request_data, dict):
            raw_model = request_data.get("model")
            if isinstance(raw_model, str):
                model = raw_model
        logger.info(
            "[#%d] %s %s | model=%s",
            call_id, method, self.path, model,
        )

        # Build upstream request
        url = f"{ANTHROPIC_API}{self.path}"
        req = Request(url, data=body, method=method)

        # Copy headers from client, skip hop-by-hop
        skip_headers = {"host", "connection", "transfer-encoding", "x-api-key", "authorization"}
        for key, value in self.headers.items():
            if key.lower() not in skip_headers:
                req.add_header(key, value)

        # Inject host credentials
        token = get_auth_token()
        req.add_header("x-api-key", token)

        # Forward to Anthropic
        try:
            resp = urlopen(req, timeout=300)
            status = resp.status
            resp_headers = dict(resp.headers)
            resp_body = resp.read()
        except HTTPError as e:
            status = e.code
            resp_headers = dict(e.headers)
            resp_body = e.read()

        elapsed = time.monotonic() - start

        # Log response
        resp_data = None
        if resp_body:
            try:
                resp_data = json.loads(resp_body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                resp_data = {"raw_bytes": len(resp_body)}

        usage: dict[str, int] = {}
        if isinstance(resp_data, dict):
            raw_usage = resp_data.get("usage")
            if isinstance(raw_usage, dict):
                usage = raw_usage
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)

        logger.info(
            "[#%d] -> %d | %s | in=%d out=%d | %.1fs",
            call_id, status, model, input_tokens, output_tokens, elapsed,
        )

        # Write detailed log entry
        if self.log_dir:
            self._write_log(call_id, method, model, status, elapsed,
                           input_tokens, output_tokens, request_data, resp_data)

        # Send response back to container
        self.send_response(status)
        for key, value in resp_headers.items():
            if key.lower() not in ("transfer-encoding", "connection"):
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(resp_body)

    def _write_log(
        self, call_id: int, method: str, model: str, status: int,
        elapsed: float, input_tokens: int, output_tokens: int,
        request_data: dict | None, resp_data: dict | None,
    ) -> None:
        assert self.log_dir is not None
        entry = {
            "id": call_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "method": method,
            "path": self.path,
            "model": model,
            "status": status,
            "elapsed_seconds": round(elapsed, 2),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

        # Append to JSONL log
        log_file = self.log_dir / "calls.jsonl"
        with open(log_file, "a") as f:
            f.write(json.dumps(entry) + "\n")

        # Write full request/response for debugging (separate dir)
        detail_dir = self.log_dir / "detail"
        detail_dir.mkdir(exist_ok=True)
        detail_file = detail_dir / f"{call_id:06d}.json"
        detail = {
            **entry,
            "request": _sanitize(request_data),
            "response": _summarize_response(resp_data),
        }
        with open(detail_file, "w") as f:
            json.dump(detail, f, indent=2)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        # Suppress default access log, we handle our own
        pass


def _sanitize(data: dict | None) -> dict | None:
    """Remove message content to avoid logging sensitive user data."""
    if data is None:
        return None
    sanitized = {k: v for k, v in data.items() if k != "messages"}
    if "messages" in data:
        sanitized["message_count"] = len(data["messages"])
    return sanitized


def _summarize_response(data: dict | None) -> dict | None:
    """Keep usage + metadata, drop full content."""
    if data is None or not isinstance(data, dict):
        return data
    return {
        "id": data.get("id"),
        "type": data.get("type"),
        "model": data.get("model"),
        "usage": data.get("usage"),
        "stop_reason": data.get("stop_reason"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Claude Code auth proxy")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--log-dir", type=Path, default=None,
                        help="Directory for call logs (JSONL + detail)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(message)s",
        datefmt="%H:%M:%S",
    )

    # Validate credentials are available before starting
    try:
        token = get_auth_token()
        logger.info("Auth: token loaded (%s...%s)", token[:10], token[-4:])
    except RuntimeError as e:
        logger.error(str(e))
        sys.exit(1)

    if args.log_dir:
        args.log_dir.mkdir(parents=True, exist_ok=True)
        logger.info("Logging calls to %s", args.log_dir)
    ProxyHandler.log_dir = args.log_dir

    server = HTTPServer((args.host, args.port), ProxyHandler)
    logger.info("Proxy listening on %s:%d -> %s", args.host, args.port, ANTHROPIC_API)
    logger.info("Container config: ANTHROPIC_BASE_URL=http://host.containers.internal:%d", args.port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down (%d calls served)", ProxyHandler._call_count)
        server.shutdown()


if __name__ == "__main__":
    main()
