#!/bin/bash
# Lock down container networking:
# - Allow traffic to host proxy only
# - Allow DNS resolution
# - Block everything else outbound
#
# The proxy on the host is the ONLY way out to the internet.

set -euo pipefail

HOST_PROXY="host.containers.internal"
PROXY_PORT="${CLAUDE_PROXY_PORT:-8080}"

# Resolve the host gateway IP
HOST_IP=$(getent hosts "$HOST_PROXY" | awk '{print $1}')
if [ -z "$HOST_IP" ]; then
    echo "WARNING: Could not resolve $HOST_PROXY, skipping firewall"
    exit 0
fi

echo "Firewall: allowing only $HOST_IP:$PROXY_PORT"

# Flush existing rules
iptables -F OUTPUT 2>/dev/null || true

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS (needed for resolution)
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Allow proxy on host
iptables -A OUTPUT -d "$HOST_IP" -p tcp --dport "$PROXY_PORT" -j ACCEPT

# Drop everything else
iptables -A OUTPUT -j DROP

echo "Firewall: active — container can only reach proxy at $HOST_IP:$PROXY_PORT"
