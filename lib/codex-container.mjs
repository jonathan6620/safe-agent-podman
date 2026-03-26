import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const IMAGE = "codex-sandbox";
const HOST_CODEX_AUTH = path.join(os.homedir(), ".codex", "auth.json");
export const OPENAI_API_DOMAINS = ["api.openai.com"];
export const MANAGED_ENV_KEYS = [
  "CODEX_MODEL",
  "DEVC_BYPASS_SANDBOX",
  "DEVP_ALLOW_HOSTS",
  "DEVP_API_DOMAINS",
  "DEVP_SAFE_NETWORK",
  "DEVP_NO_FIREWALL",
];

export function containerName(workspace) {
  const base = path.basename(workspace.replace(/\/+$/, ""));
  return `devq-${base}`;
}

export function containerEnv({
  model,
  allowHosts = [],
  bypass = true,
  safeNetwork = false,
}) {
  const env = {
    DEVP_API_DOMAINS: OPENAI_API_DOMAINS.join(","),
  };

  if (model) {
    env.CODEX_MODEL = model;
  }
  if (bypass) {
    env.DEVC_BYPASS_SANDBOX = "1";
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

export function buildArgs({
  workspace,
  name,
  image = IMAGE,
  model,
  allowHosts = [],
  bypass = true,
  safeNetwork = false,
}) {
  const args = [
    "-d",
    `--name=${name}`,
    "--userns=keep-id",
    "--security-opt=label=disable",
    "--cap-add=NET_ADMIN",
    "--cap-add=NET_RAW",
    "--network=slirp4netns:allow_host_loopback=true",
  ];

  for (const [key, value] of Object.entries(
    containerEnv({ model, allowHosts, bypass, safeNetwork })
  )) {
    args.push("-e", `${key}=${value}`);
  }

  if (fs.existsSync(HOST_CODEX_AUTH)) {
    args.push("-v", `${HOST_CODEX_AUTH}:/home/vscode/.codex/auth.json:ro,Z`);
  }

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
    "codex-sandbox-history:/commandhistory",
    image
  );

  return args;
}
