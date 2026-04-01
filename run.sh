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
BYPASS=""
SAFE_NETWORK=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --port) PROXY_PORT="$2"; shift 2 ;;
        --workspace) WORKSPACE="$2"; shift 2 ;;
        --log-dir) LOG_DIR="$2"; shift 2 ;;
        --model) CLAUDE_MODEL="$2"; shift 2 ;;
        --allow-host) ALLOW_HOSTS="${ALLOW_HOSTS:+${ALLOW_HOSTS},}$2"; shift 2 ;;
        --bypass) BYPASS="1"; shift ;;
        --safe-network) SAFE_NETWORK="1"; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Check for auth -- OAuth session from ~/.claude/.credentials.json is used by default.
# On macOS, credentials are in the Keychain; extract to a temp file for mounting.
# ANTHROPIC_API_KEY is supported as an optional override.
CREDS_TMPDIR=""
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    if [ -f "${HOME}/.claude/.credentials.json" ]; then
        : # file exists, will be mounted directly
    elif [ "$(uname)" = "Darwin" ]; then
        KEYCHAIN_DATA=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
        if [ -n "${KEYCHAIN_DATA}" ]; then
            CREDS_TMPDIR=$(mktemp -d "${TMPDIR:-/tmp}/devp-creds-XXXXXX")
            echo "${KEYCHAIN_DATA}" > "${CREDS_TMPDIR}/.credentials.json"
            chmod 600 "${CREDS_TMPDIR}/.credentials.json"
        else
            echo "ERROR: No auth found."
            echo "  Log in with 'claude' first, or set ANTHROPIC_API_KEY."
            exit 1
        fi
    else
        echo "ERROR: No auth found."
        echo "  Log in with 'claude' first (creates ~/.claude/.credentials.json)"
        echo "  Or set ANTHROPIC_API_KEY for API key auth."
        exit 1
    fi
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
    if [ -n "${CREDS_TMPDIR}" ]; then
        rm -rf "${CREDS_TMPDIR}"
    fi
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
elif [ -n "${CREDS_TMPDIR}" ] && [ -f "${CREDS_TMPDIR}/.credentials.json" ]; then
    CREDS_MOUNT="-v ${CREDS_TMPDIR}/.credentials.json:/home/vscode/.claude/.credentials.json:ro,Z"
fi
# NOTE: ~/.claude.json is copied after container start (not bind-mounted)
# to avoid truncation when the host rewrites the file atomically.

# Firewall: on when --allow-host is used, off by default
NO_FIREWALL=""
if [ -z "${ALLOW_HOSTS}" ] && [ -z "${SAFE_NETWORK}" ]; then
    NO_FIREWALL="1"
fi

podman run -d \
    --name claude-sandbox \
    --userns=keep-id \
    --security-opt=label=disable \
    --security-opt=unmask=/proc/* \
    --cap-add=NET_ADMIN \
    --cap-add=NET_RAW \
    --cap-add=SYS_ADMIN \
    --cap-add=SETUID \
    --cap-add=SETGID \
    --device=/dev/fuse \
    --device=/dev/net/tun \
    --network=slirp4netns:allow_host_loopback=true \
    -e "CLAUDE_PROXY_PORT=${PROXY_PORT}" \
    -e "ANTHROPIC_BASE_URL=http://host.containers.internal:${PROXY_PORT}" \
    ${CLAUDE_MODEL:+-e "CLAUDE_MODEL=${CLAUDE_MODEL}"} \
    ${BYPASS:+-e "DEVP_BYPASS_PERMISSIONS=1"} \
    ${ALLOW_HOSTS:+-e "DEVP_ALLOW_HOSTS=${ALLOW_HOSTS}"} \
    ${NO_FIREWALL:+-e "DEVP_NO_FIREWALL=1"} \
    ${SAFE_NETWORK:+-e "DEVP_SAFE_NETWORK=1"} \
    ${CREDS_MOUNT} \
    -v "${WORKSPACE}:/workspace:Z" \
    -v "claude-sandbox-history:/commandhistory" \
    claude-sandbox

# Copy ~/.claude.json into the container (avoids truncation from host writes)
if [ -f "${HOME}/.claude.json" ]; then
    podman cp "${HOME}/.claude.json" claude-sandbox:/home/vscode/.claude.json
fi

# Attach interactive shell
podman exec -it claude-sandbox zsh
