import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildArgs,
  CLAUDE_API_DOMAINS,
  containerConfig,
  containerName,
  diffContainerConfig,
  envListToMap,
  proxyBaseUrl,
} from "../lib/container.mjs";

describe("containerName", () => {
  it("derives name from workspace path", () => {
    assert.equal(containerName("/home/user/my-project"), "devp-my-project");
  });

  it("handles trailing slash", () => {
    assert.equal(containerName("/home/user/my-project/"), "devp-my-project");
  });
});

describe("buildArgs", () => {
  it("includes required podman run flags", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
    });

    assert.ok(args.includes("--userns=keep-id"));
    assert.ok(args.includes("--security-opt=label=disable"));
    assert.ok(args.includes("--cap-add=NET_ADMIN"));
    assert.ok(args.includes("--cap-add=NET_RAW"));
    assert.ok(
      args.some((a) => a.includes("slirp4netns:allow_host_loopback=true"))
    );
  });

  it("sets CLAUDE_PROXY_PORT only when log is true", () => {
    const withLog = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 9090,
      name: "devp-project",
      image: "claude-sandbox",
      log: true,
    });
    assert.ok(withLog.some((a) => a === "CLAUDE_PROXY_PORT=9090"));
    assert.ok(
      withLog.some((a) => a === `ANTHROPIC_BASE_URL=${proxyBaseUrl(9090)}`)
    );

    const withoutLog = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 9090,
      name: "devp-project",
      image: "claude-sandbox",
    });
    assert.ok(!withoutLog.some((a) => a.startsWith("CLAUDE_PROXY_PORT=")));
  });

  it("sets Anthropic domains for the firewall", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
    });
    assert.ok(
      args.some((a) => a === `DEVP_API_DOMAINS=${CLAUDE_API_DOMAINS.join(",")}`)
    );
  });

  it("mounts host credentials read-only when file exists", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
    });
    // Credentials mount depends on whether host file exists
    // Just verify no ANTHROPIC_API_KEY=proxy-managed is set
    assert.ok(!args.some((a) => a === "ANTHROPIC_API_KEY=proxy-managed"));
  });

  it("mounts workspace at /workspace", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
    });
    assert.ok(args.some((a) => a === "/home/user/project:/workspace:Z"));
  });

  it("includes CLAUDE_MODEL when model is set", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
      model: "sonnet",
    });
    assert.ok(args.some((a) => a === "CLAUDE_MODEL=sonnet"));
  });

  it("omits CLAUDE_MODEL when model is not set", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
    });
    assert.ok(!args.some((a) => a.startsWith("CLAUDE_MODEL=")));
  });

  it("disables firewall by default (no --allow-host)", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
    });
    assert.ok(args.some((a) => a === "DEVP_NO_FIREWALL=1"));
  });

  it("enables firewall when --allow-host is used", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
      allowHosts: ["github.com"],
    });
    assert.ok(!args.some((a) => a === "DEVP_NO_FIREWALL=1"));
    assert.ok(args.some((a) => a === "DEVP_ALLOW_HOSTS=github.com"));
  });

  it("enables firewall when --safe-network is used", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
      safeNetwork: true,
    });
    assert.ok(!args.some((a) => a === "DEVP_NO_FIREWALL=1"));
    assert.ok(args.some((a) => a === "DEVP_SAFE_NETWORK=1"));
  });

  it("sets bypass permissions when --bypass is used", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
      bypass: true,
    });
    assert.ok(args.some((a) => a === "DEVP_BYPASS_PERMISSIONS=1"));
  });

  it("does not include podman-in-podman flags", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
    });
    assert.ok(!args.includes("--cap-add=SYS_ADMIN"));
    assert.ok(!args.includes("--cap-add=SETUID"));
    assert.ok(!args.includes("--cap-add=SETGID"));
    assert.ok(!args.includes("--device=/dev/fuse"));
    assert.ok(!args.includes("--device=/dev/net/tun"));
  });

  it("uses default image when not specified", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
    });
    assert.ok(args.includes("claude-sandbox"));
  });

  it("uses custom image when specified", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "my-custom-image",
    });
    assert.ok(args.includes("my-custom-image"));
    assert.ok(!args.includes("claude-sandbox"));
  });

  it("runs detached with correct name", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-myproject",
      image: "claude-sandbox",
    });
    assert.ok(args.includes("-d"));
    assert.ok(args.includes("--name=devp-myproject"));
  });

  it("mounts command history volume", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
    });
    assert.ok(args.includes("claude-sandbox-history:/commandhistory"));
  });

  it("passes git identity from host", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
    });
    // Git identity depends on host config; just verify no crash
    // and that args is a valid array
    assert.ok(Array.isArray(args));
    assert.ok(args.length > 0);
  });

  it("combines allowHosts and safeNetwork", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
      allowHosts: ["npmjs.org"],
      safeNetwork: true,
    });
    assert.ok(args.some((a) => a === "DEVP_ALLOW_HOSTS=npmjs.org"));
    assert.ok(args.some((a) => a === "DEVP_SAFE_NETWORK=1"));
    assert.ok(!args.some((a) => a === "DEVP_NO_FIREWALL=1"));
  });

  it("joins multiple allowHosts with commas", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
      allowHosts: ["github.com", "npmjs.org", "pypi.org"],
    });
    assert.ok(args.some((a) => a === "DEVP_ALLOW_HOSTS=github.com,npmjs.org,pypi.org"));
  });

  it("omits bypass when disabled", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
      bypass: false,
    });
    assert.ok(!args.some((a) => a === "DEVP_BYPASS_PERMISSIONS=1"));
  });
});

describe("proxyBaseUrl", () => {
  it("formats host and port", () => {
    assert.equal(proxyBaseUrl(8080), "http://host.containers.internal:8080");
  });
});

describe("envListToMap", () => {
  it("maps env lists to objects", () => {
    assert.deepEqual(envListToMap(["A=1", "B=two=parts"]), {
      A: "1",
      B: "two=parts",
    });
  });

  it("returns empty object for empty list", () => {
    assert.deepEqual(envListToMap([]), {});
  });

  it("returns empty object for undefined", () => {
    assert.deepEqual(envListToMap(), {});
  });

  it("skips entries without =", () => {
    assert.deepEqual(envListToMap(["VALID=1", "NOPE", "ALSO_VALID=2"]), {
      VALID: "1",
      ALSO_VALID: "2",
    });
  });
});

describe("containerConfig", () => {
  it("uses default image", () => {
    const config = containerConfig({ proxyPort: 8080 });
    assert.equal(config.image, "claude-sandbox");
  });

  it("accepts custom image", () => {
    const config = containerConfig({ image: "my-image", proxyPort: 8080 });
    assert.equal(config.image, "my-image");
  });

  it("passes env options through", () => {
    const config = containerConfig({ proxyPort: 8080, model: "opus", log: true });
    assert.equal(config.env.CLAUDE_MODEL, "opus");
    assert.equal(config.env.ANTHROPIC_BASE_URL, proxyBaseUrl(8080));
  });
});

describe("diffContainerConfig", () => {
  it("detects managed config drift", () => {
    const desired = containerConfig({
      image: "claude-sandbox",
      proxyPort: 8080,
      model: "sonnet",
      allowHosts: ["github.com"],
      safeNetwork: true,
      log: true,
    });
    const actual = {
      image: "localhost/other-sandbox:latest",
      env: {
        ANTHROPIC_BASE_URL: proxyBaseUrl(8081),
        CLAUDE_PROXY_PORT: "8081",
        CLAUDE_MODEL: "opus",
        DEVP_BYPASS_PERMISSIONS: "1",
        DEVP_ALLOW_HOSTS: "github.com",
      },
    };

    const diffs = diffContainerConfig(actual, desired);
    assert.deepEqual(
      diffs.map(({ key }) => key),
      [
        "image",
        "ANTHROPIC_BASE_URL",
        "CLAUDE_PROXY_PORT",
        "CLAUDE_MODEL",
        "DEVP_API_DOMAINS",
        "DEVP_SAFE_NETWORK",
      ]
    );
  });

  it("returns empty array when configs match", () => {
    const config = containerConfig({ proxyPort: 8080 });
    const diffs = diffContainerConfig(
      { image: config.image, env: { ...config.env } },
      config,
    );
    assert.deepEqual(diffs, []);
  });

  it("normalizes localhost/ prefix and :latest suffix", () => {
    const config = containerConfig({ proxyPort: 8080 });
    const diffs = diffContainerConfig(
      { image: "localhost/claude-sandbox:latest", env: { ...config.env } },
      config,
    );
    assert.deepEqual(diffs, []);
  });

  it("skips image comparison when actual image is null", () => {
    const config = containerConfig({ proxyPort: 8080 });
    const diffs = diffContainerConfig(
      { image: null, env: { ...config.env } },
      config,
    );
    assert.deepEqual(diffs, []);
  });

  it("ignores non-managed env keys", () => {
    const config = containerConfig({ proxyPort: 8080 });
    const diffs = diffContainerConfig(
      { image: config.image, env: { ...config.env, RANDOM_VAR: "whatever" } },
      config,
    );
    assert.deepEqual(diffs, []);
  });
});
