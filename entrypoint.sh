#!/bin/bash
# Run setup on first start, then exec the user's command.
set -euo pipefail

# Bootstrap PATH for non-interactive commands (mirrors .zshrc)
export FNM_DIR="/usr/local/share/fnm"
eval "$(fnm env --shell bash)"
export PATH="$HOME/.local/bin:$PATH"

SETUP_DONE="/tmp/.devp-setup-done"

if [ ! -f "$SETUP_DONE" ]; then
  bash /setup/post-create.sh

  # Create claude wrapper in ~/.local/bin (first in PATH)
  cat > /home/vscode/.local/bin/claude << 'WRAPPER'
#!/bin/bash
CLAUDE_BIN=$(echo /usr/local/share/claude/versions/*)
exec "$CLAUDE_BIN" "$@"
WRAPPER
  chmod +x /home/vscode/.local/bin/claude

  touch "$SETUP_DONE"
fi

# Default: keep container alive for shell attachment via devp shell/up
# If a command is given, run it instead.
if [ $# -eq 0 ]; then
  exec sleep infinity
else
  exec "$@"
fi
