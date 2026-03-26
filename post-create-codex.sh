#!/bin/bash
set -euo pipefail

set_bat_theme() {
  local theme="$1"
  if grep -q '^export BAT_THEME=' "${HOME}/.zshrc" 2>/dev/null; then
    sed -i "s|^export BAT_THEME=.*|export BAT_THEME=\"${theme}\"|" "${HOME}/.zshrc"
  elif grep -q '^# BAT_THEME' "${HOME}/.zshrc" 2>/dev/null; then
    sed -i "s|^# BAT_THEME.*|export BAT_THEME=\"${theme}\"|" "${HOME}/.zshrc"
  else
    echo "export BAT_THEME=\"${theme}\"" >> "${HOME}/.zshrc"
  fi
}

sudo apt-get update -qq 2>/dev/null || echo "WARNING: apt-get update failed (network restricted?)"
sudo -E bash /setup/firewall.sh || echo "WARNING: Firewall setup failed (missing NET_ADMIN?)"

mkdir -p "${HOME}/.codex"
set_bat_theme "Monokai Extended"

if [ -f "${HOME}/.codex/auth.json" ]; then
  AUTH_STATUS="mounted host auth"
else
  AUTH_STATUS="no auth mount"
fi

if [ "${DEVC_BYPASS_SANDBOX:-1}" = "1" ]; then
  PERM_MODE="danger-full-access"
else
  PERM_MODE="codex-managed"
fi

echo "Codex sandbox ready"
echo "  Model:   ${CODEX_MODEL:-default}"
echo "  Perms:   ${PERM_MODE}"
echo "  Auth:    ${AUTH_STATUS}"
