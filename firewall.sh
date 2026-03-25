#!/bin/bash
# Lock down container networking:
# - Allow traffic to Anthropic API endpoints (for Claude Code auth + API)
# - Allow traffic to host proxy (for logging)
# - Allow extra hosts via DEVP_ALLOW_HOSTS (comma-separated)
# - Allow DNS resolution
# - Block everything else outbound
#
# Set DEVP_NO_FIREWALL=1 to skip all rules (full network access).

set -euo pipefail

if [ "${DEVP_NO_FIREWALL:-}" = "1" ]; then
  echo "Firewall: DISABLED (--no-firewall)"
  exit 0
fi

# Safe network mode: allow package managers + common dev registries
SAFE_DOMAINS=()
if [ "${DEVP_SAFE_NETWORK:-}" = "1" ]; then
  SAFE_DOMAINS+=(
    # APT / Ubuntu
    "archive.ubuntu.com"
    "security.ubuntu.com"
    "ppa.launchpadcontent.net"
    # npm
    "registry.npmjs.org"
    # PyPI
    "pypi.org"
    "files.pythonhosted.org"
    # GitHub (releases, clones)
    "github.com"
    "objects.githubusercontent.com"
    "raw.githubusercontent.com"
    # Rust / Cargo
    "crates.io"
    "static.crates.io"
    # Go modules
    "proxy.golang.org"
    "sum.golang.org"
  )
fi

PROXY_PORT="${CLAUDE_PROXY_PORT:-8080}"

# Allowed Anthropic domains
ANTHROPIC_DOMAINS=(
  "api.anthropic.com"
  "platform.claude.com"
  "mcp-proxy.anthropic.com"
  "status.anthropic.com"
  "statsigapi.net"
)

# Flush existing rules
iptables -F OUTPUT 2>/dev/null || true

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS (needed for resolution)
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Allow host proxy
HOST_PROXY="host.containers.internal"
HOST_IP=$(getent hosts "$HOST_PROXY" | awk '{print $1}')
if [ -n "$HOST_IP" ]; then
  iptables -A OUTPUT -d "$HOST_IP" -p tcp --dport "$PROXY_PORT" -j ACCEPT
  echo "Firewall: proxy allowed at $HOST_IP:$PROXY_PORT"
fi

# Allow Anthropic domains (IPv4 only -- iptables doesn't handle IPv6)
for domain in "${ANTHROPIC_DOMAINS[@]}"; do
  ips=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true)
  for ip in $ips; do
    iptables -A OUTPUT -d "$ip" -p tcp --dport 443 -j ACCEPT
    echo "Firewall: allowed $domain ($ip)"
  done
done

# Allow extra hosts from DEVP_ALLOW_HOSTS (comma-separated)
if [ -n "${DEVP_ALLOW_HOSTS:-}" ]; then
  IFS=',' read -ra EXTRA_HOSTS <<< "$DEVP_ALLOW_HOSTS"
  for domain in "${EXTRA_HOSTS[@]}"; do
    domain=$(echo "$domain" | xargs)  # trim whitespace
    ips=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true)
    for ip in $ips; do
      iptables -A OUTPUT -d "$ip" -p tcp --dport 443 -j ACCEPT
      iptables -A OUTPUT -d "$ip" -p tcp --dport 80 -j ACCEPT
      echo "Firewall: allowed $domain ($ip)"
    done
  done
fi

# Allow safe network domains (package managers, registries)
for domain in "${SAFE_DOMAINS[@]}"; do
  ips=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true)
  for ip in $ips; do
    iptables -A OUTPUT -d "$ip" -p tcp --dport 443 -j ACCEPT
    iptables -A OUTPUT -d "$ip" -p tcp --dport 80 -j ACCEPT
    echo "Firewall: allowed $domain ($ip) [safe-network]"
  done
done

# Drop everything else
iptables -A OUTPUT -j DROP

echo "Firewall: active -- only allowed hosts reachable"
