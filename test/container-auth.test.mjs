import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureCredentialsFile } from "../lib/auth.mjs";

const IMAGE = "claude-sandbox";
const HOST_CREDENTIALS = path.join(os.homedir(), ".claude", ".credentials.json");

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

// Track temp credential files for cleanup
const tmpCredsFiles = [];

function getCredsMountArgs() {
  const credsFile = ensureCredentialsFile(HOST_CREDENTIALS);
  if (!credsFile) return "";
  if (credsFile !== HOST_CREDENTIALS) tmpCredsFiles.push(path.dirname(credsFile));
  return `-v ${credsFile}:/home/vscode/.claude/.credentials.json:ro,Z`;
}

function podmanRun(envs, cmd, { useEntrypoint = false } = {}) {
  const envArgs = envs.map((e) => `-e ${e}`).join(" ");
  const credsMount = getCredsMountArgs();
  const claudeJsonMount = fs.existsSync(path.join(os.homedir(), ".claude.json"))
    ? `-v $HOME/.claude.json:/home/vscode/.claude.json:Z`
    : "";
  if (useEntrypoint) {
    return execSync(
      `podman run --rm --userns=keep-id --cap-add=NET_ADMIN --cap-add=NET_RAW ` +
        `${envArgs} ${credsMount} ${claudeJsonMount} ${IMAGE} ${cmd}`,
      { encoding: "utf-8", timeout: 30000 }
    ).trim();
  }
  return execSync(
    `podman run --rm --userns=keep-id --cap-add=NET_ADMIN --cap-add=NET_RAW ` +
      `--entrypoint bash ${envArgs} ${credsMount} ${claudeJsonMount} ${IMAGE} -c "${cmd}"`,
    { encoding: "utf-8", timeout: 30000 }
  ).trim();
}

describe("container auth", { skip: !podmanAvailable() && "podman or image not available" }, () => {
  afterEach(() => {
    for (const dir of tmpCredsFiles) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpCredsFiles.length = 0;
  });
  it("has credentials file mounted", () => {
    const out = podmanRun(
      ["CLAUDE_PROXY_PORT=8080"],
      "test -f ~/.claude/.credentials.json && echo mounted || echo missing"
    );
    assert.equal(out, "mounted");
  });

  it("has ~/.claude.json mounted with hasCompletedOnboarding", () => {
    const out = podmanRun(
      ["CLAUDE_PROXY_PORT=8080"],
      "grep -c hasCompletedOnboarding ~/.claude.json"
    );
    assert.ok(parseInt(out, 10) > 0);
  });

  it("has oauthAccount in ~/.claude.json", () => {
    const out = podmanRun(
      ["CLAUDE_PROXY_PORT=8080"],
      "grep -c accountUuid ~/.claude.json"
    );
    assert.ok(parseInt(out, 10) > 0);
  });

  it("post-create writes settings.json with model and bypassPermissions", () => {
    const out = podmanRun(
      ["CLAUDE_PROXY_PORT=8080", "CLAUDE_MODEL=sonnet"],
      "bash /setup/post-create.sh >/dev/null 2>&1; cat ~/.claude/settings.json"
    );
    const settings = JSON.parse(out);
    assert.equal(settings.model, "sonnet");
    assert.equal(settings.permissions.defaultMode, "bypassPermissions");
  });

  it("post-create writes BAT_THEME into .zshrc", () => {
    const out = podmanRun(
      ["CLAUDE_PROXY_PORT=8080"],
      "bash /setup/post-create.sh >/dev/null 2>&1; grep '^export BAT_THEME=' ~/.zshrc"
    );
    assert.match(out, /^export BAT_THEME="(GitHub|Monokai Extended)"$/);
  });

  it("entrypoint runs setup and executes command", () => {
    const out = podmanRun(
      ["CLAUDE_PROXY_PORT=8080"],
      "claude --version",
      { useEntrypoint: true }
    );
    assert.match(out, /Claude Code/);
  });
});
