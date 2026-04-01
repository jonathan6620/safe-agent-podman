# safe-agent-podman for Codex

This repository now includes a sibling Podman workflow for running OpenAI Codex inside the same style of external container boundary as `devp`.

Use `devq` when you want:

- a separate `codex-sandbox` image
- rootless Podman isolation with the same firewall options
- host Codex auth reused via `~/.codex/auth.json`
- Codex itself to run in `--dangerously-bypass-approvals-and-sandbox` mode by default, with the container acting as the security boundary

## Quick start

```bash
npm link
devq build
devq up ~/my-project
```

Host auth is required first:

```bash
codex login
```

## CLI

```text
devq <command> [options]

Commands:
  up [PATH]        Start Codex container (default: current dir)
  down             Stop the running container
  rm               Remove a stopped container
  shell            Open a shell in the running container
  exec CMD...      Run a command in the running container
  rebuild          Rebuild the Codex container image
  status           Show auth and container status
  build            Build the Codex container image

Options:
  --image IMAGE       Container image (default: codex-sandbox)
  --model MODEL       Codex model override
  --no-bypass         Keep Codex sandbox/approval controls enabled
  --allow-host HOST   Restrict network to OpenAI + HOST (repeatable)
  --safe-network      Allow package managers (apt, npm, pip, etc.) through firewall
```

## Security model

1. `devq` mounts host Codex auth from `~/.codex/auth.json` read-only when present.
2. `codex` inside the container is wrapped so it applies the configured model automatically and bypasses its own sandbox by default.
3. The same container firewall model is reused, but the default provider allowlist is `api.openai.com` instead of Anthropic domains.
4. `--no-bypass` keeps Codex's own approval and sandbox controls enabled if you prefer a second layer.

## Files

- `bin/devq.mjs`: Codex lifecycle CLI
- `lib/codex-container.mjs`: Podman args + config drift checks for Codex
- `lib/codex-auth.mjs`: Host auth detection for Codex
- `Containerfile.codex`: Codex image
- `entrypoint-codex.sh`: Codex wrapper/bootstrap
- `post-create-codex.sh`: Codex container setup
