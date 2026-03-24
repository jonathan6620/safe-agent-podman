#!/bin/bash
# Run setup on first start, then exec the user's command.
set -euo pipefail

SETUP_DONE="/tmp/.devp-setup-done"

if [ ! -f "$SETUP_DONE" ]; then
  bash /setup/post-create.sh
  touch "$SETUP_DONE"
fi

# Default to interactive shell if no command given
if [ $# -eq 0 ]; then
  exec zsh
else
  exec "$@"
fi
