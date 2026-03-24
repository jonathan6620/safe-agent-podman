#!/bin/bash
set -euo pipefail

# Apply network firewall (requires NET_ADMIN)
sudo bash /setup/firewall.sh

echo "Claude Code sandbox ready"
echo "API proxied through host at ${ANTHROPIC_BASE_URL}"
echo "No credentials stored in this container"
