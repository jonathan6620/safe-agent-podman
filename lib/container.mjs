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
export function buildArgs({ workspace, proxyPort, name, image = IMAGE, model, allowHosts = [], noFirewall = false, log = false, proxyAuth = false }) {
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
  if (log || proxyAuth) {
    args.push("-e", `CLAUDE_PROXY_PORT=${proxyPort}`);
  }
  if (model) {
    args.push("-e", `CLAUDE_MODEL=${model}`);
  }
  if (noFirewall) {
    args.push("-e", "DEVP_NO_FIREWALL=1");
  }
  if (allowHosts.length > 0) {
    args.push("-e", `DEVP_ALLOW_HOSTS=${allowHosts.join(",")}`);
  }
  if (proxyAuth) {
    // No credentials in container -- proxy injects auth on outbound requests.
    // Claude runs in --bare mode with ANTHROPIC_BASE_URL pointing to the proxy.
    args.push(
      "-e", `ANTHROPIC_BASE_URL=http://host.containers.internal:${proxyPort}`,
      "-e", "ANTHROPIC_API_KEY=proxy-managed",
      "-e", "DEVP_PROXY_AUTH=1",
    );
  } else {
    // Default: mount host credentials into the container
    if (fs.existsSync(HOST_CREDENTIALS)) {
      args.push("-v", `${HOST_CREDENTIALS}:/home/vscode/.claude/.credentials.json:ro,Z`);
    }
    if (fs.existsSync(HOST_CLAUDE_JSON)) {
      args.push("-v", `${HOST_CLAUDE_JSON}:/home/vscode/.claude.json:Z`);
    }
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
