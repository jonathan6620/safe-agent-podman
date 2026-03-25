# safe-agent-podman

A Podman-based sandbox for running Claude Code with `bypassPermissions` safely enabled. The container's firewall restricts network access to Anthropic endpoints only, preventing credential exfiltration while allowing full tool use.

## Architecture

```
+----------------------+        +--------------------+
|   Container          | :443   | api.anthropic.com  |
+----------------------+        +--------------------+
|                      |------->|                    |
|  Claude Code         |        | platform.claude.com|
|  (bypassPermissions) |<-------|                    |
|                      |        +--------------------+
|  ~/.claude.json      |
|  ~/.claude/.creds    |  (mounts from host)
+----------------------+
         |
         X--- google.com (BLOCKED)
         X--- github.com (BLOCKED by default)
```

Host auth files are mounted into the container (`~/.claude/.credentials.json` read-only, `~/.claude.json` writable for project trust settings). The iptables firewall blocks all outbound traffic except Anthropic API endpoints. Use `--allow-host` to whitelist additional domains, `--safe-network` to allow package managers, or omit both for full access.

## Prerequisites

- [Podman](https://podman.io/docs/installation) (rootless)
- Python 3.10+
- Claude Code logged in (`claude` -- uses your existing OAuth session)

## Quick start

```bash
# 1. Install devp
npm link

# 2. Build the container image
devp build
# or: podman build -t claude-sandbox .

# 3. Run (uses your Claude OAuth session automatically)
devp up ~/my-project
```

## devp CLI

`devp` manages the container lifecycle. Install with `npm link` from this repo.

```
devp <command> [options]

Commands:
  up [PATH]           Start container (default: current dir)
  down                Stop the running container
  shell               Open a shell in the running container
  exec CMD...         Run a command in the running container
  status              Show auth and container status
  build               Build the container image
  logs                Tail proxy call logs

Options:
  --image IMAGE       Container image (default: claude-sandbox)
  --model MODEL       Claude model (default: opus)
  --no-bypass         Disable bypassPermissions (default: on)
  --allow-host HOST   Restrict network to Anthropic + HOST (repeatable)
  --safe-network      Allow package managers (apt, npm, pip, etc.) through firewall
  --log               Enable API call logging via host proxy
  --port PORT         Proxy port (default: 8080)
```

### Network modes

| Mode | Firewall | Package install | Use case |
| ---- | -------- | --------------- | -------- |
| Default (no flags) | Off | Full access | Trusted environments |
| `--safe-network` | On | Yes (apt, npm, pip, cargo, go) | Install dependencies safely |
| `--allow-host HOST` | On | No (unless HOST is a registry) | Minimal access |
| `--safe-network --allow-host HOST` | On | Yes + custom domains | Dependencies + specific APIs |

The `--safe-network` flag allows connections to these domains through the firewall:

- **APT**: `archive.ubuntu.com`, `security.ubuntu.com`, `ppa.launchpadcontent.net`
- **npm**: `registry.npmjs.org`
- **PyPI**: `pypi.org`, `files.pythonhosted.org`
- **GitHub**: `github.com`, `objects.githubusercontent.com`, `raw.githubusercontent.com`
- **Cargo**: `crates.io`, `static.crates.io`
- **Go**: `proxy.golang.org`, `sum.golang.org`

### Installing packages

The container allows `apt` and `apt-get` without `sudo`:

```bash
# Inside the container -- no sudo needed
apt install -y jq
apt-get install -y build-essential
```

### Examples

```bash
# Full network access (default)
devp up ~/my-project

# Firewall on, but allow package managers
devp up --safe-network ~/my-project

# Firewall on, package managers + custom domain
devp up --safe-network --allow-host api.github.com ~/project

# Restrict network to Anthropic + GitHub only (no package managers)
devp up --allow-host github.com --allow-host api.github.com ~/project

# Use a specific model
devp up --model sonnet ~/project

# Check status
devp status

# Open a shell / run a command
devp shell
devp exec claude --version

# Stop
devp down
```

### run.sh (alternative)

The shell launcher supports the same options:

```bash
./run.sh --workspace ~/project --safe-network
./run.sh --workspace ~/project --allow-host github.com
./run.sh --workspace ~/project  # no firewall (default)
```

## Files

| File                  | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `bin/devp.mjs`        | CLI -- manages container lifecycle                        |
| `lib/auth.mjs`        | Reads OAuth token from `~/.claude/.credentials.json`      |
| `lib/proxy-check.mjs` | Health check for the auth proxy                           |
| `lib/container.mjs`   | Builds podman run arguments                               |
| `proxy.py`            | Host-side reverse proxy -- logs all API calls to JSONL    |
| `run.sh`              | Shell launcher (alternative to `devp`)                    |
| `Dockerfile`          | Container image -- Ubuntu 24.04, Node.js 22, Claude Code (native installer) |
| `devcontainer.json`   | VS Code / devcontainer CLI configuration                  |
| `firewall.sh`         | iptables rules -- restricts outbound network access       |
| `entrypoint.sh`       | Container entrypoint -- runs setup on first start         |
| `post-create.sh`      | Setup -- applies firewall, configures claude, seeds trust |

## Security model

1. **Rootless Podman** -- no Docker daemon, no root. Runs as your host user via `--userns=keep-id`.
2. **Mounted credentials** -- `~/.claude/.credentials.json` mounted read-only, `~/.claude.json` writable (for workspace trust).
3. **Network firewall (opt-in)** -- use `--allow-host` or `--safe-network` to restrict outbound traffic. Without either, network is open.
4. **bypassPermissions (default: on)** -- use `--no-bypass` to disable. The container is the security boundary.
5. **Sudoless package install** -- `apt` and `apt-get` work without `sudo` inside the container for easy dependency installation.

## API call logging

Pass `--log` to start the host-side proxy for API call logging:

```bash
devp up --log ~/my-project
```

Writes to `./logs/`:
- `calls.jsonl` -- one JSON object per call (timestamp, model, tokens, latency)
- `detail/000001.json` -- per-call metadata (no message content)

## Environment variables

### Host-side

Auth is read from `~/.claude/.credentials.json` and `~/.claude.json` automatically.

| Variable                  | Required | Description                                          |
| ------------------------- | -------- | ---------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | No       | Override: use an API key instead of OAuth session    |
| `CLAUDE_PROXY_KEY_HELPER` | No       | Override: shell command that outputs an API key      |

### Container-side (set automatically)

| Variable                  | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `CLAUDE_MODEL`            | Model alias (default: opus, override: `--model`)      |
| `DEVP_BYPASS_PERMISSIONS` | Set to 1 for bypassPermissions (default, disable: `--no-bypass`) |
| `DEVP_ALLOW_HOSTS`        | Comma-separated allowed domains (enables firewall)    |
| `DEVP_SAFE_NETWORK`       | Set to 1 to allow package manager domains through firewall |
| `DEVP_NO_FIREWALL`        | Set to 1 when no `--allow-host`/`--safe-network` (open network) |
| `CLAUDE_PROXY_PORT`       | Proxy port for firewall rules (set with `--log`)      |

## Inspired by

- [trailofbits/claude-code-devcontainer](https://github.com/trailofbits/claude-code-devcontainer) -- Docker-based Claude Code sandbox with `bypassPermissions`
