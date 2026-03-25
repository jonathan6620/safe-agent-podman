#!/bin/bash
set -euo pipefail

# Apply network firewall (requires NET_ADMIN, may fail in test runs)
sudo -E bash /setup/firewall.sh || echo "WARNING: Firewall setup failed (missing NET_ADMIN?)"

# Configure Claude Code
CLAUDE_DIR="${HOME}/.claude"
mkdir -p "${CLAUDE_DIR}"

# Settings: model + permissions mode
CLAUDE_MODEL="${CLAUDE_MODEL:-opus}"
if [ "${DEVP_BYPASS_PERMISSIONS:-1}" = "1" ]; then
  PERM_MODE="bypassPermissions"
else
  PERM_MODE="default"
fi
echo '{"model":"'"${CLAUDE_MODEL}"'","permissions":{"defaultMode":"'"${PERM_MODE}"'"}}' \
  > "${CLAUDE_DIR}/settings.json"

# Set bat theme based on Claude theme preference
if [ -f "${HOME}/.claude.json" ]; then
  CLAUDE_THEME=$(python3 -c "import json; print(json.load(open('${HOME}/.claude.json')).get('theme','dark'))" 2>/dev/null || echo "dark")
else
  CLAUDE_THEME="dark"
fi
if [ "$CLAUDE_THEME" = "light" ]; then
  BAT_THEME="GitHub"
else
  BAT_THEME="Monokai Extended"
fi
# Write BAT_THEME into .zshrc (replace placeholder or append)
if grep -q '^# BAT_THEME' "${HOME}/.zshrc" 2>/dev/null; then
  sed -i "s|^# BAT_THEME.*|export BAT_THEME=\"${BAT_THEME}\"|" "${HOME}/.zshrc"
else
  echo "export BAT_THEME=\"${BAT_THEME}\"" >> "${HOME}/.zshrc"
fi

# Seed workspace trust by running claude once in print mode
claude -p "ok" --dangerously-skip-permissions > /dev/null 2>&1 || true

echo "Claude Code sandbox ready"
echo "  Model:   ${CLAUDE_MODEL}"
echo "  Perms:   ${PERM_MODE}"
