import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DEFAULT_CODEX_AUTH = path.join(os.homedir(), ".codex", "auth.json");

export function hasCodexAuth(authPath = DEFAULT_CODEX_AUTH) {
  return !!process.env.OPENAI_API_KEY || fs.existsSync(authPath);
}
