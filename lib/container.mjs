import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const IMAGE = "claude-sandbox";
const HOST_CREDENTIALS = path.join(os.homedir(), ".claude", ".credentials.json");
const HOST_CLAUDE_JSON = path.join(os.homedir(), ".claude.json");

/** Derive a container name from the workspace path. */
export function containerName(workspace) {
  const base = path.basename(workspace.replace(/\/+$/, ""));
  return `devp-${base}`;
}

/** Build the podman run argument array. */
export function buildArgs({ workspace, proxyPort, name, image = IMAGE, model, allowHosts = [], bypass = true, safeNetwork = false, log = false }) {
  const args = [
    "-it",
    "--rm",
    `--name=${name}`,
    "--userns=keep-id",
    "--security-opt=label=disable",
    "--cap-add=NET_ADMIN",
    "--cap-add=NET_RAW",
    "--network=slirp4netns:allow_host_loopback=true",
  ];
  if (log) {
    args.push("-e", `CLAUDE_PROXY_PORT=${proxyPort}`);
  }
  if (model) {
    args.push("-e", `CLAUDE_MODEL=${model}`);
  }
  if (bypass) {
    args.push("-e", "DEVP_BYPASS_PERMISSIONS=1");
  }
  // Firewall: on when --allow-host or --safe-network is used, off by default
  if (allowHosts.length > 0 || safeNetwork) {
    if (allowHosts.length > 0) {
      args.push("-e", `DEVP_ALLOW_HOSTS=${allowHosts.join(",")}`);
    }
    if (safeNetwork) {
      args.push("-e", "DEVP_SAFE_NETWORK=1");
    }
  } else {
    args.push("-e", "DEVP_NO_FIREWALL=1");
  }
  // Mount host auth files so Claude Code can authenticate.
  if (fs.existsSync(HOST_CREDENTIALS)) {
    args.push("-v", `${HOST_CREDENTIALS}:/home/vscode/.claude/.credentials.json:ro,Z`);
  }
  if (fs.existsSync(HOST_CLAUDE_JSON)) {
    args.push("-v", `${HOST_CLAUDE_JSON}:/home/vscode/.claude.json:Z`);
  }
  args.push(
    "-v",
    `${workspace}:/workspace:Z`,
    "-v",
    "claude-sandbox-history:/commandhistory",
    image,
  );
  return args;
}
