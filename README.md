# safe-agent-podman

A Podman-based sandbox for running Claude Code with `bypassPermissions` safely enabled. A host-side auth proxy keeps credentials off the container entirely while logging every API call.

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐        ┌───────────────────┐
│   Container          │  :8080  │   Host Proxy          │ :443   │ api.anthropic.com  │
│                      │────────>│                       │───────>│                    │
│  Claude Code         │         │  1. Log request       │        │                    │
│  (no credentials)    │<────────│  2. Inject OAuth token │<───────│                    │
│                      │         │  3. Forward response   │        │                    │
│  ANTHROPIC_BASE_URL  │         │                       │        │                    │
│  = http://host:8080  │         │  Holds OAuth on host   │        │                    │
└─────────────────────┘         └──────────────────────┘        └───────────────────┘
```

The container's firewall (iptables) blocks all outbound traffic except to the host proxy. Claude can **use** the credentials but cannot **exfiltrate** them.

## Prerequisites

- [Podman](https://podman.io/docs/installation) (rootless)
- Python 3.10+
- Claude Code logged in (`claude` — uses your existing OAuth session)

## Quick start

```bash
# 1. Build the container image
podman build -t claude-sandbox .

# 2. Run (uses your Claude OAuth session automatically)
devp up ~/my-project
```

## devp CLI

`devp` manages the proxy and container lifecycle. Install with `npm link` from this repo.

```
devp <command> [options]

Commands:
  up [PATH]        Start proxy + container (default: current dir)
  down             Stop the running container
  shell            Open a shell in the running container
  exec CMD...      Run a command in the running container
  status           Show proxy and container status
  build            Build the container image
  rebuild          Alias for build
  logs             Tail proxy call logs

Options:
  --port PORT      Proxy port (default: 8080)
  --image IMAGE    Container image (default: claude-sandbox)
```

### Examples

```bash
# Review untrusted code
devp up ~/sketchy-repo

# Check auth and proxy health
devp status

# Open a shell in the running container
devp shell

# Run a one-off command
devp exec claude --version

# Custom proxy port
devp up --port 9090 ~/project

# Stop the container
devp down
```

### run.sh (alternative)

The original shell launcher is still available:

```bash
./run.sh --workspace ~/my-project --port 8080 --log-dir ./logs
```

## Files

| File                | Purpose                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| `bin/devp.mjs`      | CLI entry point — manages proxy and container lifecycle                     |
| `lib/auth.mjs`      | Reads OAuth token from `~/.claude/.credentials.json`                        |
| `lib/proxy-check.mjs` | Health check for the auth proxy                                           |
| `lib/container.mjs` | Builds podman run arguments                                                 |
| `proxy.py`          | Host-side reverse proxy — injects auth headers, logs all API calls to JSONL |
| `run.sh`            | Shell launcher (alternative to `devp`)                                      |
| `Dockerfile`        | Container image — Ubuntu 24.04, Node.js 22, Claude Code                     |
| `devcontainer.json` | VS Code / devcontainer CLI configuration                                    |
| `firewall.sh`       | iptables rules — container can only reach the proxy                         |
| `post-create.sh`    | Container startup — applies firewall rules                                  |

## Security model

1. **No credentials in the container** — `ANTHROPIC_API_KEY` is set to the literal string `"proxy-managed"`. The real OAuth token lives only in the host proxy process (read from `~/.claude/.credentials.json`).
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

By default, the proxy reads your Claude Code OAuth session from `~/.claude/.credentials.json` — no environment variables needed.

| Variable                  | Required | Description                                           |
| ------------------------- | -------- | ----------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | No       | Override: use an API key instead of the OAuth session |
| `CLAUDE_PROXY_KEY_HELPER` | No       | Override: shell command that outputs an API key       |

### Container-side (set automatically)

| Variable             | Value                                  | Description                                         |
| -------------------- | -------------------------------------- | --------------------------------------------------- |
| `ANTHROPIC_BASE_URL` | `http://host.containers.internal:8080` | Points Claude Code at the proxy                     |
| `ANTHROPIC_API_KEY`  | `proxy-managed`                        | Placeholder so Claude Code doesn't prompt for login |
| `CLAUDE_PROXY_PORT`  | `8080`                                 | Used by `firewall.sh` to configure iptables         |

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

This project takes a different approach: instead of sharing credentials into the container, it proxies authenticated requests from the host using your existing Claude Code OAuth session, keeping credentials completely out of the sandbox.
