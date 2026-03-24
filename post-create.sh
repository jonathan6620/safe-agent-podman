#!/bin/bash
set -euo pipefail

# Apply network firewall (requires NET_ADMIN, may fail in test runs)
sudo -E bash /setup/firewall.sh || echo "WARNING: Firewall setup failed (missing NET_ADMIN?)"

# Configure Claude Code
CLAUDE_DIR="${HOME}/.claude"
mkdir -p "${CLAUDE_DIR}"

# Settings: model + bypassPermissions
CLAUDE_MODEL="${CLAUDE_MODEL:-opus}"
echo '{"model":"'"${CLAUDE_MODEL}"'","permissions":{"defaultMode":"bypassPermissions"}}' \
  > "${CLAUDE_DIR}/settings.json"

# Set bat theme based on Claude theme preference
if [ -f "${HOME}/.claude.json" ]; then
  CLAUDE_THEME=$(python3 -c "import json; print(json.load(open('${HOME}/.claude.json')).get('theme','dark'))" 2>/dev/null || echo "dark")
  if [ "$CLAUDE_THEME" = "light" ]; then
    export BAT_THEME="GitHub"
  else
    export BAT_THEME="Monokai Extended"
  fi
  echo "export BAT_THEME=\"${BAT_THEME}\"" >> "${HOME}/.zshrc" 2>/dev/null || true
  echo "export BAT_THEME=\"${BAT_THEME}\"" >> "${HOME}/.bashrc" 2>/dev/null || true
fi

# Pre-accept workspace trust by running claude once in print mode
# (-p skips the trust dialog and seeds the acceptance in .claude.json)
claude -p "ok" --dangerously-skip-permissions > /dev/null 2>&1 || true

# Check auth files
CREDS_OK="no"
CLAUDE_JSON_OK="no"
[ -f "${CLAUDE_DIR}/.credentials.json" ] && CREDS_OK="yes"
[ -f "${HOME}/.claude.json" ] && CLAUDE_JSON_OK="yes"

echo "Claude Code sandbox ready"
echo "  Model:       ${CLAUDE_MODEL}"
echo "  Proxy port:  ${CLAUDE_PROXY_PORT:-not set}"
echo "  Credentials: ${CREDS_OK}"
echo "  claude.json: ${CLAUDE_JSON_OK}"
echo "  Perms:       bypassPermissions"
