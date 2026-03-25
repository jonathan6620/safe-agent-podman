#!/bin/bash
set -euo pipefail

export FNM_DIR="/usr/local/share/fnm"
eval "$(fnm env --shell bash)"
export PATH="$HOME/.local/bin:$PATH"

SETUP_DONE="/tmp/.devc-setup-done"

if [ ! -f "$SETUP_DONE" ]; then
  bash /setup/post-create.sh

  cat > /home/vscode/.local/bin/codex << 'WRAPPER'
#!/bin/bash
set -euo pipefail

REAL_CODEX_BIN="/usr/local/share/fnm/aliases/default/bin/codex"
EXTRA_ARGS=()

if [ -n "${CODEX_MODEL:-}" ]; then
  EXTRA_ARGS+=("--model" "${CODEX_MODEL}")
fi

if [ "${DEVC_BYPASS_SANDBOX:-1}" = "1" ]; then
  EXTRA_ARGS+=("--dangerously-bypass-approvals-and-sandbox")
fi

exec "${REAL_CODEX_BIN}" "${EXTRA_ARGS[@]}" "$@"
WRAPPER
  chmod +x /home/vscode/.local/bin/codex

  touch "$SETUP_DONE"
fi

if [ $# -eq 0 ]; then
  exec sleep infinity
else
  exec "$@"
fi
