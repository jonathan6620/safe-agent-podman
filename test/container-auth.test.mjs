import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildArgs,
  copyHostConfig,
  copyHostCredentials,
} from "../lib/container.mjs";

const IMAGE = "claude-sandbox";

function podmanAvailable() {
  try {
    execSync("podman --version", { stdio: "pipe" });
    const out = execSync(`podman image exists ${IMAGE} && echo yes || echo no`, {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    return out === "yes";
  } catch {
    return false;
  }
}

const LARGE_WORKSPACE = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../geneweaver-search"
);

function largeWorkspaceAvailable() {
  try {
    return podmanAvailable() && fs.existsSync(LARGE_WORKSPACE);
  } catch {
    return false;
  }
}

/**
 * Create a container with podman cp'd auth files (matching the real devp up flow),
 * start it, run a command, then return stdout.
 */
function createAndRun(name, workspace, envs, cmd, { useEntrypoint = false } = {}) {
  const args = buildArgs({
    workspace,
    proxyPort: 8080,
    name,
    image: IMAGE,
  });

  execFileSync("podman", ["create", ...args], { stdio: "ignore" });
  copyHostCredentials(name);
  copyHostConfig(name);
  execFileSync("podman", ["start", name], { stdio: "ignore" });

  // Wait for container to be running
  for (let i = 0; i < 10; i++) {
    try {
      const status = execFileSync(
        "podman", ["inspect", "--format", "{{.State.Status}}", name],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
      if (status === "running") break;
    } catch { /* not ready */ }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }

  return execSync(
    `podman exec ${name} bash -c ${JSON.stringify(cmd)}`,
    { encoding: "utf-8", timeout: 30000 }
  ).trim();
}

describe("container auth (create+cp flow)", {
  skip: !largeWorkspaceAvailable() && "podman, image, or geneweaver-search not available",
}, () => {
  const name = "devp-authtest";

  afterEach(() => {
    try { execSync(`podman rm -f ${name}`, { stdio: "ignore" }); } catch { /* ignore */ }
  });

  it("credentials file is readable by vscode user", () => {
    const out = createAndRun(name, LARGE_WORKSPACE, [],
      "cat /home/vscode/.claude/.credentials.json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"ok\" if \"claudeAiOauth\" in d else \"bad\")'");
    assert.equal(out, "ok");
  });

  it("credentials file is owned by vscode", () => {
    const out = createAndRun(name, LARGE_WORKSPACE, [],
      "stat -c '%U' /home/vscode/.claude/.credentials.json");
    assert.equal(out, "vscode");
  });

  it(".claude.json is readable with hasCompletedOnboarding", () => {
    const out = createAndRun(name, LARGE_WORKSPACE, [],
      "grep -c hasCompletedOnboarding /home/vscode/.claude.json");
    assert.ok(parseInt(out, 10) > 0);
  });

  it(".claude.json has oauthAccount", () => {
    const out = createAndRun(name, LARGE_WORKSPACE, [],
      "grep -c accountUuid /home/vscode/.claude.json");
    assert.ok(parseInt(out, 10) > 0);
  });

  it(".claude.json is owned by vscode", () => {
    const out = createAndRun(name, LARGE_WORKSPACE, [],
      "stat -c '%U' /home/vscode/.claude.json");
    assert.equal(out, "vscode");
  });

  it("post-create writes settings.json with model and bypassPermissions", () => {
    const out = createAndRun(name, LARGE_WORKSPACE, [],
      "bash /setup/post-create.sh >/dev/null 2>&1; cat ~/.claude/settings.json");
    const settings = JSON.parse(out);
    assert.equal(settings.permissions.defaultMode, "bypassPermissions");
  });

  it("post-create writes BAT_THEME into .zshrc", () => {
    const out = createAndRun(name, LARGE_WORKSPACE, [],
      "bash /setup/post-create.sh >/dev/null 2>&1; grep '^export BAT_THEME=' ~/.zshrc");
    assert.match(out, /^export BAT_THEME="(GitHub|Monokai Extended)"$/);
  });
});
