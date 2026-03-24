import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildArgs, containerName } from "../lib/container.mjs";

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

  it("sets ANTHROPIC_BASE_URL to proxy", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 9090,
      name: "devp-project",
      image: "claude-sandbox",
    });
    assert.ok(
      args.some(
        (a) => a === "ANTHROPIC_BASE_URL=http://host.containers.internal:9090"
      )
    );
  });

  it("sets ANTHROPIC_API_KEY to proxy-managed", () => {
    const args = buildArgs({
      workspace: "/home/user/project",
      proxyPort: 8080,
      name: "devp-project",
      image: "claude-sandbox",
    });
    assert.ok(args.some((a) => a === "ANTHROPIC_API_KEY=proxy-managed"));
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
});
