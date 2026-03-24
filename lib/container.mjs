import path from "node:path";

const IMAGE = "claude-sandbox";

/** Derive a container name from the workspace path. */
export function containerName(workspace) {
  const base = path.basename(workspace.replace(/\/+$/, ""));
  return `devp-${base}`;
}

/** Build the podman run argument array. */
export function buildArgs({ workspace, proxyPort, name, image = IMAGE }) {
  return [
    "-it",
    "--rm",
    `--name=${name}`,
    "--userns=keep-id",
    "--security-opt=label=disable",
    "--cap-add=NET_ADMIN",
    "--cap-add=NET_RAW",
    "--network=slirp4netns:allow_host_loopback=true",
    "-e",
    `ANTHROPIC_BASE_URL=http://host.containers.internal:${proxyPort}`,
    "-e",
    "ANTHROPIC_API_KEY=proxy-managed",
    "-e",
    `CLAUDE_PROXY_PORT=${proxyPort}`,
    "-v",
    `${workspace}:/workspace:Z`,
    "-v",
    "claude-sandbox-history:/commandhistory",
    image,
  ];
}
