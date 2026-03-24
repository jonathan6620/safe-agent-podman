#!/bin/bash
# Start the host-side proxy and launch the container.
#
# Usage:
#   ./run.sh                    # defaults
#   ./run.sh --port 9090        # custom proxy port
#   ./run.sh --workspace ~/code # mount a different workspace

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROXY_PORT=8080
WORKSPACE="${PWD}"
LOG_DIR="${SCRIPT_DIR}/logs"
CLAUDE_MODEL=""
ALLOW_HOSTS=""
NO_FIREWALL=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --port) PROXY_PORT="$2"; shift 2 ;;
        --workspace) WORKSPACE="$2"; shift 2 ;;
        --log-dir) LOG_DIR="$2"; shift 2 ;;
        --model) CLAUDE_MODEL="$2"; shift 2 ;;
        --allow-host) ALLOW_HOSTS="${ALLOW_HOSTS:+${ALLOW_HOSTS},}$2"; shift 2 ;;
        --no-firewall) NO_FIREWALL="1"; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Check for auth -- OAuth session from ~/.claude/.credentials.json is used by default.
# ANTHROPIC_API_KEY is supported as an optional override.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ ! -f "${HOME}/.claude/.credentials.json" ]; then
    echo "ERROR: No auth found."
    echo "  Log in with 'claude' first (creates ~/.claude/.credentials.json)"
    echo "  Or set ANTHROPIC_API_KEY for API key auth."
    exit 1
fi

echo "=== Claude Code Auth Proxy ==="
echo "Proxy port:  ${PROXY_PORT}"
echo "Workspace:   ${WORKSPACE}"
echo "Log dir:     ${LOG_DIR}"
echo ""

# Start proxy in background
python3 "${SCRIPT_DIR}/proxy.py" \
    --port "${PROXY_PORT}" \
    --log-dir "${LOG_DIR}" &
PROXY_PID=$!

cleanup() {
    echo ""
    echo "Stopping proxy (PID ${PROXY_PID})..."
    kill "${PROXY_PID}" 2>/dev/null || true
    wait "${PROXY_PID}" 2>/dev/null || true
    echo "Done."
}
trap cleanup EXIT

sleep 1

# Verify proxy is running
if ! kill -0 "${PROXY_PID}" 2>/dev/null; then
    echo "ERROR: Proxy failed to start"
    exit 1
fi

echo "Proxy running on :${PROXY_PORT}"
echo ""

# Launch container with podman
# Mount host auth files read-only for Claude Code auth.
# Network firewall prevents exfiltration -- container can only reach the proxy.
CREDS_MOUNT=""
if [ -f "${HOME}/.claude/.credentials.json" ]; then
    CREDS_MOUNT="-v ${HOME}/.claude/.credentials.json:/home/vscode/.claude/.credentials.json:ro,Z"
fi
CLAUDE_JSON_MOUNT=""
if [ -f "${HOME}/.claude.json" ]; then
    CLAUDE_JSON_MOUNT="-v ${HOME}/.claude.json:/home/vscode/.claude.json:Z"
fi

podman run -it --rm \
    --name claude-sandbox \
    --userns=keep-id \
    --security-opt=label=disable \
    --cap-add=NET_ADMIN \
    --cap-add=NET_RAW \
    --network=slirp4netns:allow_host_loopback=true \
    -e "CLAUDE_PROXY_PORT=${PROXY_PORT}" \
    ${CLAUDE_MODEL:+-e "CLAUDE_MODEL=${CLAUDE_MODEL}"} \
    ${NO_FIREWALL:+-e "DEVP_NO_FIREWALL=1"} \
    ${ALLOW_HOSTS:+-e "DEVP_ALLOW_HOSTS=${ALLOW_HOSTS}"} \
    ${CREDS_MOUNT} \
    ${CLAUDE_JSON_MOUNT} \
    -v "${WORKSPACE}:/workspace:Z" \
    -v "claude-sandbox-history:/commandhistory" \
    claude-sandbox \
    "$@"
