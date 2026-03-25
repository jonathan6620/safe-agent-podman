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
else
  CLAUDE_THEME="dark"
fi
if [ "$CLAUDE_THEME" = "light" ]; then
  export BAT_THEME="GitHub"
else
  export BAT_THEME="Monokai Extended"
fi
echo "export BAT_THEME=\"${BAT_THEME}\"" >> "${HOME}/.zshrc" 2>/dev/null || true
echo "export BAT_THEME=\"${BAT_THEME}\"" >> "${HOME}/.bashrc" 2>/dev/null || true

# Seed workspace trust (skip in proxy-auth mode -- no OAuth, uses --bare)
if [ "${DEVP_PROXY_AUTH:-}" != "1" ]; then
  claude -p "ok" --dangerously-skip-permissions > /dev/null 2>&1 || true
fi

# Status
AUTH_MODE="mounted credentials"
if [ "${DEVP_PROXY_AUTH:-}" = "1" ]; then
  AUTH_MODE="proxy-injected (no creds in container)"
fi

echo "Claude Code sandbox ready"
echo "  Model:   ${CLAUDE_MODEL}"
echo "  Auth:    ${AUTH_MODE}"
echo "  Perms:   bypassPermissions"
