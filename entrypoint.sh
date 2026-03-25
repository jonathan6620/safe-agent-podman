#!/bin/bash
# Run setup on first start, then exec the user's command.
set -euo pipefail

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

# Default to interactive shell if no command given
if [ $# -eq 0 ]; then
  exec zsh
else
  exec "$@"
fi
