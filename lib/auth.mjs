import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_CREDENTIALS = path.join(
  os.homedir(),
  ".claude",
  ".credentials.json"
);

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
 * Get authentication token.
 * Priority: ANTHROPIC_API_KEY env → OAuth credentials file.
 * Returns null if nothing found.
 */
export function getAuthToken(credentialsPath = DEFAULT_CREDENTIALS) {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;

  return readOAuthToken(credentialsPath);
}
