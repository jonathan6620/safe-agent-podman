import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

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

function podmanRun(envs, cmd, { useEntrypoint = false } = {}) {
  const envArgs = envs.map((e) => `-e ${e}`).join(" ");
  const credsMount = `-v $HOME/.claude/.credentials.json:/home/vscode/.claude/.credentials.json:ro,Z`;
  const claudeJsonMount = `-v $HOME/.claude.json:/home/vscode/.claude.json:Z`;
  if (useEntrypoint) {
    // Let entrypoint handle it -- pass command as args
    const parts = cmd.split(" ");
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

  it("entrypoint runs setup and executes command", () => {
    const out = podmanRun(
      ["CLAUDE_PROXY_PORT=8080"],
      "claude --version",
      { useEntrypoint: true }
    );
    assert.match(out, /Claude Code/);
  });
});
