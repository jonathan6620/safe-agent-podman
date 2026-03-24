import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { checkProxy } from "../lib/proxy-check.mjs";

describe("checkProxy", () => {
  let server;
  let port;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = server.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("returns true when proxy is reachable", async () => {
    const result = await checkProxy(port, "127.0.0.1");
    assert.equal(result, true);
  });

  it("returns false when proxy is not reachable", async () => {
    const result = await checkProxy(19999, "127.0.0.1");
    assert.equal(result, false);
  });
});
