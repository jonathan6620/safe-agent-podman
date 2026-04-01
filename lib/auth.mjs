import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const DEFAULT_CREDENTIALS = path.join(
  os.homedir(),
  ".claude",
  ".credentials.json"
);

const KEYCHAIN_SERVICE = "Claude Code-credentials";

/** Read the OAuth access token from Claude Code's credentials file. */
export function readOAuthToken(credentialsPath = DEFAULT_CREDENTIALS) {
  try {
    const data = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
    const token = data?.claudeAiOauth?.accessToken;
    return token || null;
  } catch {
    return null;
  }
}

/**
 * On macOS, Claude Code stores credentials in the Keychain instead of
 * ~/.claude/.credentials.json.  Returns the JSON string or null.
 */
export function readKeychainCredentials() {
  if (process.platform !== "darwin") return null;
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (!raw) return null;
    // Validate it's parseable JSON before returning
    JSON.parse(raw);
    return raw;
  } catch {
    return null;
  }
}

/**
 * Ensure a credentials file exists on disk (for mounting into containers).
 * If the file already exists, returns its path.
 * On macOS, extracts from Keychain into a temp file and returns that path.
 * Returns null if no credentials are available.
 */
export function ensureCredentialsFile(credentialsPath = DEFAULT_CREDENTIALS) {
  if (fs.existsSync(credentialsPath)) return credentialsPath;

  const keychainData = readKeychainCredentials();
  if (!keychainData) return null;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devp-creds-"));
  const tmpFile = path.join(tmpDir, ".credentials.json");
  fs.writeFileSync(tmpFile, keychainData, { mode: 0o600 });
  return tmpFile;
}

/**
 * Get authentication token.
 * Priority: ANTHROPIC_API_KEY env > credentials file > macOS Keychain.
 * Returns null if nothing found.
 */
export function getAuthToken(credentialsPath = DEFAULT_CREDENTIALS) {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;

  const fileToken = readOAuthToken(credentialsPath);
  if (fileToken) return fileToken;

  // On macOS, try the Keychain
  const keychainData = readKeychainCredentials();
  if (keychainData) {
    try {
      const data = JSON.parse(keychainData);
      return data?.claudeAiOauth?.accessToken || null;
    } catch {
      return null;
    }
  }

  return null;
}
