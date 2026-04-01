import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { ensureCredentialsFile } from "./auth.mjs";

const IMAGE = "claude-sandbox";
const PROXY_HOST = "host.containers.internal";
const HOST_CREDENTIALS = path.join(os.homedir(), ".claude", ".credentials.json");
const HOST_CLAUDE_JSON = path.join(os.homedir(), ".claude.json");
export const CLAUDE_API_DOMAINS = [
  "api.anthropic.com",
  "platform.claude.com",
  "mcp-proxy.anthropic.com",
  "status.anthropic.com",
  "statsigapi.net",
];
export const MANAGED_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "CLAUDE_PROXY_PORT",
  "CLAUDE_MODEL",
  "DEVP_BYPASS_PERMISSIONS",
  "DEVP_ALLOW_HOSTS",
  "DEVP_API_DOMAINS",
  "DEVP_SAFE_NETWORK",
  "DEVP_NO_FIREWALL",
];

/** Derive a container name from the workspace path. */
export function containerName(workspace) {
  const base = path.basename(workspace.replace(/\/+$/, ""));
  return `devp-${base}`;
}

export function proxyBaseUrl(port) {
  return `http://${PROXY_HOST}:${port}`;
}

export function containerEnv({
  proxyPort,
  model,
  allowHosts = [],
  bypass = true,
  safeNetwork = false,
  log = false,
}) {
  const env = {};

  env.DEVP_API_DOMAINS = CLAUDE_API_DOMAINS.join(",");

  if (log) {
    env.CLAUDE_PROXY_PORT = String(proxyPort);
    env.ANTHROPIC_BASE_URL = proxyBaseUrl(proxyPort);
  }
  if (model) {
    env.CLAUDE_MODEL = model;
  }
  if (bypass) {
    env.DEVP_BYPASS_PERMISSIONS = "1";
  }
  if (allowHosts.length > 0) {
    env.DEVP_ALLOW_HOSTS = allowHosts.join(",");
  }
  if (safeNetwork) {
    env.DEVP_SAFE_NETWORK = "1";
  }
  if (allowHosts.length === 0 && !safeNetwork) {
    env.DEVP_NO_FIREWALL = "1";
  }

  return env;
}

export function containerConfig({ image = IMAGE, ...options }) {
  return {
    image,
    env: containerEnv(options),
  };
}

export function envListToMap(envList = []) {
  const env = {};
  for (const entry of envList) {
    const separator = entry.indexOf("=");
    if (separator === -1) {
      continue;
    }
    env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return env;
}

export function diffContainerConfig(actual, desired) {
  const diffs = [];
  const actualImage = normalizeImageRef(actual.image);
  const desiredImage = normalizeImageRef(desired.image);

  if (actualImage && desiredImage && actualImage !== desiredImage) {
    diffs.push({
      key: "image",
      actual: actual.image,
      expected: desired.image,
    });
  }

  for (const key of MANAGED_ENV_KEYS) {
    const actualValue = actual.env[key] ?? null;
    const expectedValue = desired.env[key] ?? null;
    if (actualValue !== expectedValue) {
      diffs.push({
        key,
        actual: actualValue,
        expected: expectedValue,
      });
    }
  }

  return diffs;
}

function normalizeImageRef(image) {
  if (!image) {
    return null;
  }
  return image.replace(/^localhost\//, "").replace(/:latest$/, "");
}

/** Build the podman create argument array. */
export function buildArgs({ workspace, proxyPort, name, image = IMAGE, model, allowHosts = [], bypass = true, safeNetwork = false, log = false }) {
  const args = [
    `--name=${name}`,
    "--userns=keep-id",
    "--security-opt=label=disable",
    "--security-opt=unmask=/proc/*",
    "--cap-add=NET_ADMIN",
    "--cap-add=NET_RAW",
    "--network=slirp4netns:allow_host_loopback=true",
  ];
  for (const [key, value] of Object.entries(
    containerEnv({ proxyPort, model, allowHosts, bypass, safeNetwork, log })
  )) {
    args.push("-e", `${key}=${value}`);
  }
  // NOTE: auth files (.credentials.json and .claude.json) are copied into
  // the container after creation via copyHostCredentials / copyHostConfig,
  // rather than bind-mounted, to avoid UID mismatch (host UID != container
  // vscode UID) and truncation issues.
  // Pass host git identity so the agent can make commits inside the container.
  for (const key of ["user.name", "user.email"]) {
    try {
      const val = execFileSync("git", ["config", key], { encoding: "utf8" }).trim();
      if (val) {
        const envKey = `GIT_${key === "user.name" ? "USER_NAME" : "USER_EMAIL"}`;
        args.push("-e", `${envKey}=${val}`);
      }
    } catch { /* not configured on host, skip */ }
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

/**
 * Synchronous sleep using Atomics (avoids spawning a subprocess).
 */
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Wait until the container is in a state where `podman cp` can write
 * into its filesystem.  Polls `podman inspect` for a copyable status.
 */
function waitForContainer(name, { maxAttempts = 10, intervalMs = 300 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const out = execFileSync(
        "podman",
        ["inspect", "--format", "{{.State.Status}}", name],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
      if (out === "created" || out === "exited" || out === "stopped" || out === "running") {
        return true;
      }
    } catch { /* container not ready yet */ }
    if (i < maxAttempts - 1) {
      sleepMs(intervalMs);
    }
  }
  return false;
}

/**
 * Copy credentials (.credentials.json) into the container.
 * Uses podman cp instead of a bind-mount so that the file is owned by
 * the container's vscode user regardless of the host UID.
 */
export function copyHostCredentials(name, { maxAttempts = 5, intervalMs = 500 } = {}) {
  const credsFile = ensureCredentialsFile(HOST_CREDENTIALS);
  if (!credsFile) {
    return;
  }

  if (!waitForContainer(name)) {
    throw new Error(`Container ${name} not ready for file copy`);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      execFileSync("podman", ["cp", credsFile, `${name}:/home/vscode/.claude/.credentials.json`], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      return;
    } catch (err) {
      if (attempt < maxAttempts - 1) {
        sleepMs(intervalMs);
      } else {
        throw new Error(
          `Failed to copy credentials into ${name} after ${maxAttempts} attempts: ${err.message}`
        );
      }
    }
  }
}

/**
 * Copy ~/.claude.json into the container (instead of bind-mounting).
 * This avoids truncation when the host rewrites the file while the
 * container is reading it.
 *
 * Retries the copy to handle the race where the container filesystem
 * is not yet ready after `podman create` (e.g. large workspace mounts
 * with SELinux relabeling).
 */
export function copyHostConfig(name, { maxAttempts = 5, intervalMs = 500 } = {}) {
  if (!fs.existsSync(HOST_CLAUDE_JSON)) {
    return;
  }

  if (!waitForContainer(name)) {
    throw new Error(`Container ${name} not ready for file copy`);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      execFileSync("podman", ["cp", HOST_CLAUDE_JSON, `${name}:/home/vscode/.claude.json`], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      return; // success
    } catch (err) {
      if (attempt < maxAttempts - 1) {
        sleepMs(intervalMs);
      } else {
        throw new Error(
          `Failed to copy ${HOST_CLAUDE_JSON} into ${name} after ${maxAttempts} attempts: ${err.message}`
        );
      }
    }
  }
}
