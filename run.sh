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

while [[ $# -gt 0 ]]; do
    case $1 in
        --port) PROXY_PORT="$2"; shift 2 ;;
        --workspace) WORKSPACE="$2"; shift 2 ;;
        --log-dir) LOG_DIR="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Check for API key
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "ERROR: Set ANTHROPIC_API_KEY before running"
    echo "  export ANTHROPIC_API_KEY=sk-ant-..."
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
podman run -it --rm \
    --name claude-sandbox \
    --userns=keep-id \
    --security-opt=label=disable \
    --cap-add=NET_ADMIN \
    --cap-add=NET_RAW \
    --network=slirp4netns:allow_host_loopback=true \
    -e "ANTHROPIC_BASE_URL=http://host.containers.internal:${PROXY_PORT}" \
    -e "ANTHROPIC_API_KEY=proxy-managed" \
    -e "CLAUDE_PROXY_PORT=${PROXY_PORT}" \
    -v "${WORKSPACE}:/workspace:Z" \
    -v "claude-sandbox-history:/commandhistory" \
    claude-sandbox \
    "$@"
