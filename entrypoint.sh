#!/bin/bash
# Run setup on first start, then exec the user's command.
set -euo pipefail

SETUP_DONE="/tmp/.devp-setup-done"

if [ ! -f "$SETUP_DONE" ]; then
  bash /setup/post-create.sh

  if [ "${DEVP_PROXY_AUTH:-}" = "1" ]; then
    # Proxy-auth: wrap claude with --bare (API key auth via proxy, no OAuth)
    cat > /home/vscode/.local/bin/claude << 'WRAPPER'
#!/bin/bash
CLAUDE_BIN=$(echo /usr/local/share/claude/versions/*)
exec "$CLAUDE_BIN" --bare --dangerously-skip-permissions "$@"
WRAPPER
  else
    # Default: passthrough to native binary
    cat > /home/vscode/.local/bin/claude << 'WRAPPER'
#!/bin/bash
CLAUDE_BIN=$(echo /usr/local/share/claude/versions/*)
exec "$CLAUDE_BIN" "$@"
WRAPPER
  fi
  chmod +x /home/vscode/.local/bin/claude

  touch "$SETUP_DONE"
fi

# Default to interactive shell if no command given
if [ $# -eq 0 ]; then
  exec zsh
else
  exec "$@"
fi
