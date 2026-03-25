import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildArgs,
  containerConfig,
  containerName,
  diffContainerConfig,
  envListToMap,
  OPENAI_API_DOMAINS,
} from "../lib/codex-container.mjs";

describe("codex containerName", () => {
  it("derives name from workspace path", () => {
    assert.equal(containerName("/home/user/my-project"), "devq-my-project");
  });

  it("handles trailing slash", () => {
    assert.equal(containerName("/home/user/my-project/"), "devq-my-project");
  });
});

describe("codex buildArgs", () => {
  it("includes required podman run flags", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      name: "devq-project",
      image: "codex-sandbox",
    });

    assert.ok(args.includes("--userns=keep-id"));
    assert.ok(args.includes("--security-opt=label=disable"));
    assert.ok(args.includes("--cap-add=NET_ADMIN"));
    assert.ok(args.includes("--cap-add=NET_RAW"));
    assert.ok(
      args.some((a) => a.includes("slirp4netns:allow_host_loopback=true"))
    );
  });

  it("sets OpenAI domains for the firewall", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      name: "devq-project",
      image: "codex-sandbox",
    });

    assert.ok(
      args.some((a) => a === `DEVP_API_DOMAINS=${OPENAI_API_DOMAINS.join(",")}`)
    );
  });

  it("includes CODEX_MODEL when model is set", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      name: "devq-project",
      image: "codex-sandbox",
      model: "codex-mini-latest",
    });
    assert.ok(args.some((a) => a === "CODEX_MODEL=codex-mini-latest"));
  });

  it("omits CODEX_MODEL when model is not set", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      name: "devq-project",
      image: "codex-sandbox",
    });
    assert.ok(!args.some((a) => a.startsWith("CODEX_MODEL=")));
  });

  it("enables bypass mode by default", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      name: "devq-project",
      image: "codex-sandbox",
    });
    assert.ok(args.some((a) => a === "DEVC_BYPASS_SANDBOX=1"));
  });

  it("disables firewall by default", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      name: "devq-project",
      image: "codex-sandbox",
    });
    assert.ok(args.some((a) => a === "DEVP_NO_FIREWALL=1"));
  });

  it("enables firewall when --allow-host is used", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      name: "devq-project",
      image: "codex-sandbox",
      allowHosts: ["github.com"],
    });
    assert.ok(!args.some((a) => a === "DEVP_NO_FIREWALL=1"));
    assert.ok(args.some((a) => a === "DEVP_ALLOW_HOSTS=github.com"));
  });

  it("enables firewall when --safe-network is used", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      name: "devq-project",
      image: "codex-sandbox",
      safeNetwork: true,
    });
    assert.ok(!args.some((a) => a === "DEVP_NO_FIREWALL=1"));
    assert.ok(args.some((a) => a === "DEVP_SAFE_NETWORK=1"));
  });

  it("mounts workspace at /workspace", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      name: "devq-project",
      image: "codex-sandbox",
    });
    assert.ok(args.some((a) => a === "/home/user/project:/workspace:Z"));
  });
});

describe("codex container config helpers", () => {
  it("maps env lists to objects", () => {
    assert.deepEqual(envListToMap(["A=1", "B=two=parts"]), {
      A: "1",
      B: "two=parts",
    });
  });

  it("detects managed config drift", () => {
    const desired = containerConfig({
      image: "codex-sandbox",
      model: "codex-mini-latest",
      allowHosts: ["github.com"],
      safeNetwork: true,
    });
    const actual = {
      image: "localhost/other-sandbox:latest",
      env: {
        CODEX_MODEL: "gpt-5.1-codex-max",
        DEVC_BYPASS_SANDBOX: "1",
        DEVP_ALLOW_HOSTS: "github.com",
        DEVP_API_DOMAINS: "api.openai.com",
      },
    };

    const diffs = diffContainerConfig(actual, desired);
    assert.deepEqual(
      diffs.map(({ key }) => key),
      ["image", "CODEX_MODEL", "DEVP_SAFE_NETWORK"]
    );
  });
});
