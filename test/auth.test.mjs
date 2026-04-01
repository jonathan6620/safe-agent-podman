import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readOAuthToken, getAuthToken } from "../lib/auth.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("readOAuthToken", () => {
  let tmpDir;
  let fakeCreds;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devp-test-"));
    fakeCreds = path.join(tmpDir, ".credentials.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads accessToken from credentials file", () => {
    fs.writeFileSync(
      fakeCreds,
      JSON.stringify({
        claudeAiOauth: { accessToken: "sk-ant-oat01-test-token" },
      })
    );
    const token = readOAuthToken(fakeCreds);
    assert.equal(token, "sk-ant-oat01-test-token");
  });

  it("returns null for missing file", () => {
    const token = readOAuthToken("/tmp/nonexistent-creds.json");
    assert.equal(token, null);
  });

  it("returns null for malformed JSON", () => {
    fs.writeFileSync(fakeCreds, "not json");
    const token = readOAuthToken(fakeCreds);
    assert.equal(token, null);
  });

  it("returns null when claudeAiOauth is missing", () => {
    fs.writeFileSync(fakeCreds, JSON.stringify({ other: "stuff" }));
    const token = readOAuthToken(fakeCreds);
    assert.equal(token, null);
  });

  it("returns null when accessToken is empty", () => {
    fs.writeFileSync(
      fakeCreds,
      JSON.stringify({ claudeAiOauth: { accessToken: "" } })
    );
    const token = readOAuthToken(fakeCreds);
    assert.equal(token, null);
  });
});

describe("getAuthToken", () => {
  let tmpDir;
  let fakeCreds;
  const origEnv = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devp-test-"));
    fakeCreds = path.join(tmpDir, ".credentials.json");
    origEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origEnv.ANTHROPIC_API_KEY !== undefined) {
      process.env.ANTHROPIC_API_KEY = origEnv.ANTHROPIC_API_KEY;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("prefers ANTHROPIC_API_KEY env var over credentials file", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-key";
    fs.writeFileSync(
      fakeCreds,
      JSON.stringify({
        claudeAiOauth: { accessToken: "sk-ant-oat01-file-token" },
      })
    );
    const token = getAuthToken(fakeCreds);
    assert.equal(token, "sk-ant-env-key");
  });

  it("falls back to credentials file", () => {
    fs.writeFileSync(
      fakeCreds,
      JSON.stringify({
        claudeAiOauth: { accessToken: "sk-ant-oat01-file-token" },
      })
    );
    const token = getAuthToken(fakeCreds);
    assert.equal(token, "sk-ant-oat01-file-token");
  });

  it("returns null when nothing is available (non-macOS) or falls back to keychain (macOS)", () => {
    const token = getAuthToken("/tmp/nonexistent-creds.json");
    if (process.platform === "darwin") {
      // On macOS, may find credentials in Keychain
      // Just verify it returns a string or null (not an error)
      assert.ok(token === null || typeof token === "string");
    } else {
      assert.equal(token, null);
    }
  });
});
