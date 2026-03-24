# safe-agent-podman

A Podman-based sandbox for running Claude Code with `bypassPermissions` safely enabled. A host-side auth proxy keeps credentials off the container entirely while logging every API call.

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐        ┌───────────────────┐
│   Container          │  :8080  │   Host Proxy          │ :443   │ api.anthropic.com  │
│                      │────────>│                       │───────>│                    │
│  Claude Code         │         │  1. Log request       │        │                    │
│  (no credentials)    │<────────│  2. Inject auth token  │<───────│                    │
│                      │         │  3. Forward response   │        │                    │
│  ANTHROPIC_BASE_URL  │         │                       │        │                    │
│  = http://host:8080  │         │  Holds API key on host │        │                    │
└─────────────────────┘         └──────────────────────┘        └───────────────────┘
```

The container's firewall (iptables) blocks all outbound traffic except to the host proxy. Claude can **use** the credentials but cannot **exfiltrate** them.

## Prerequisites

- [Podman](https://podman.io/docs/installation) (rootless)
- Python 3.10+
- An Anthropic API key

## Quick start

```bash
# 1. Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# 2. Build the container image
podman build -t claude-sandbox .

# 3. Run (starts proxy + container)
./run.sh --workspace ~/my-project
```

## Usage

```
./run.sh [OPTIONS]

Options:
  --port PORT         Proxy listen port (default: 8080)
  --workspace PATH    Directory to mount at /workspace (default: $PWD)
  --log-dir PATH      Directory for API call logs (default: ./logs)
```

### Examples

```bash
# Review untrusted code
./run.sh --workspace ~/sketchy-repo

# Custom port and log location
./run.sh --port 9090 --log-dir /tmp/claude-logs --workspace ~/project
```

## Files

| File | Purpose |
|---|---|
| `proxy.py` | Host-side reverse proxy — injects auth headers, logs all API calls to JSONL |
| `run.sh` | One-command launcher — starts proxy and container together |
| `Dockerfile` | Container image — Ubuntu 24.04, Node.js 22, Claude Code |
| `devcontainer.json` | VS Code / devcontainer CLI configuration |
| `firewall.sh` | iptables rules — container can only reach the proxy |
| `post-create.sh` | Container startup — applies firewall rules |

## Security model

1. **No credentials in the container** — `ANTHROPIC_API_KEY` is set to the literal string `"proxy-managed"`. The real key lives only in the host proxy process.
2. **Network isolation** — iptables rules drop all outbound traffic except to the host proxy. Claude cannot send tokens to arbitrary hosts.
3. **Rootless Podman** — no Docker daemon, no root process. The container runs as your host user via `--userns=keep-id`.
4. **Read-only workspace** — optionally mount with `:ro` to prevent writes to your code.

## API call logging

When `--log-dir` is set (default: `./logs`), the proxy writes:

- **`logs/calls.jsonl`** — one JSON object per call with timestamp, model, token counts, latency
- **`logs/detail/000001.json`** — per-call metadata (request params minus message content, response summary)

Message content is intentionally **not** logged to avoid storing sensitive data.

### Example log entry

```json
{
  "id": 1,
  "timestamp": "2026-03-24T15:30:00+00:00",
  "method": "POST",
  "path": "/v1/messages",
  "model": "claude-sonnet-4-20250514",
  "status": 200,
  "elapsed_seconds": 2.34,
  "input_tokens": 1500,
  "output_tokens": 800
}
```

## Environment variables

### Host-side (set before running)

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `ANTHROPIC_AUTH_TOKEN` | No | OAuth session token (added as `Authorization: Bearer` header) |
| `CLAUDE_PROXY_KEY_HELPER` | No | Shell command that outputs an API key (alternative to static key) |

### Container-side (set automatically)

| Variable | Value | Description |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `http://host.containers.internal:8080` | Points Claude Code at the proxy |
| `ANTHROPIC_API_KEY` | `proxy-managed` | Placeholder so Claude Code doesn't prompt for login |
| `CLAUDE_PROXY_PORT` | `8080` | Used by `firewall.sh` to configure iptables |

## Using as a devcontainer

The included `devcontainer.json` works with VS Code or the devcontainers CLI:

```bash
# Start the host proxy first
python3 proxy.py --port 8080 --log-dir ./logs &

# Then open in VS Code
# Or use the CLI:
devcontainer up --workspace-folder ~/my-project --docker-path podman
```

Set `"dev.containers.dockerPath": "podman"` in your VS Code settings.

## Inspired by

- [trailofbits/claude-code-devcontainer](https://github.com/trailofbits/claude-code-devcontainer) — Docker-based Claude Code sandbox with `bypassPermissions`

This project takes a different approach: instead of sharing credentials into the container, it proxies authenticated requests from the host, keeping credentials completely out of the sandbox.
