#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAuthToken } from "../lib/auth.mjs";
import { checkProxy } from "../lib/proxy-check.mjs";
import { containerName, buildArgs } from "../lib/container.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const USAGE = `Usage: devp <command> [options]

Commands:
  up [PATH]        Start proxy + container (default: current dir)
  down             Stop the running container
  shell            Open a shell in the running container
  exec CMD...      Run a command in the running container
  rebuild          Rebuild the container image
  status           Show proxy and container status
  build            Build the container image
  logs             Tail proxy logs

Options:
  --port PORT      Proxy port (default: 8080)
  --image IMAGE    Container image (default: claude-sandbox)
  -h, --help       Show this help
`;

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { command: null, rest: [], port: 8080, image: "claude-sandbox" };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--port") {
      args.port = parseInt(argv[++i], 10);
    } else if (a === "--image") {
      args.image = argv[++i];
    } else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (!args.command) {
      args.command = a;
    } else {
      args.rest.push(a);
    }
    i++;
  }
  return args;
}

function findContainer(name) {
  try {
    const out = execSync(
      `podman ps -a --filter name=^${name}$ --format '{{.ID}}'`,
      { encoding: "utf-8" }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

function isContainerRunning(name) {
  try {
    const out = execSync(
      `podman ps --filter name=^${name}$ --filter status=running --format '{{.ID}}'`,
      { encoding: "utf-8" }
    ).trim();
    return !!out;
  } catch {
    return false;
  }
}

async function startProxy(port) {
  const proxyScript = path.join(ROOT, "proxy.py");
  const logDir = path.join(ROOT, "logs");

  const proxy = spawn(
    "python3",
    [proxyScript, "--port", String(port), "--log-dir", logDir],
    {
      stdio: ["ignore", "inherit", "inherit"],
      detached: true,
    }
  );
  proxy.unref();

  // Wait for proxy to be ready
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 300));
    if (await checkProxy(port)) {
      return proxy.pid;
    }
  }
  die("Proxy failed to start within 3 seconds");
}

async function ensureProxy(port) {
  if (await checkProxy(port)) {
    console.log(`Proxy already running on :${port}`);
    return null;
  }

  // Check auth before starting proxy
  const token = getAuthToken();
  if (!token) {
    die(
      "No auth found. Log in with 'claude' first, or set ANTHROPIC_API_KEY."
    );
  }

  console.log(`Starting auth proxy on :${port}...`);
  const pid = await startProxy(port);
  console.log(`Proxy started (PID ${pid})`);
  return pid;
}

async function cmdUp(args) {
  const workspace = path.resolve(args.rest[0] || process.cwd());
  const name = containerName(workspace);

  if (isContainerRunning(name)) {
    die(`Container ${name} is already running. Use 'devp shell' to attach.`);
  }

  await ensureProxy(args.port);

  console.log(`\nStarting container ${name}...`);
  console.log(`  Workspace: ${workspace}`);
  console.log(`  Proxy:     :${args.port}`);
  console.log("");

  const runArgs = buildArgs({
    workspace,
    proxyPort: args.port,
    name,
    image: args.image,
  });

  const result = spawn("podman", ["run", ...runArgs], {
    stdio: "inherit",
  });
  result.on("exit", (code) => process.exit(code ?? 0));
}

function cmdDown(args) {
  const workspace = path.resolve(args.rest[0] || process.cwd());
  const name = containerName(workspace);

  if (!findContainer(name)) {
    die(`No container found for ${name}`);
  }

  console.log(`Stopping ${name}...`);
  execSync(`podman stop ${name}`, { stdio: "inherit" });
}

function cmdShell(args) {
  const workspace = path.resolve(args.rest[0] || process.cwd());
  const name = containerName(workspace);

  if (!isContainerRunning(name)) {
    die(`Container ${name} is not running. Use 'devp up' first.`);
  }

  const result = spawn("podman", ["exec", "-it", name, "zsh"], {
    stdio: "inherit",
  });
  result.on("exit", (code) => process.exit(code ?? 0));
}

function cmdExec(args) {
  const workspace = process.cwd();
  const name = containerName(workspace);

  if (!isContainerRunning(name)) {
    die(`Container ${name} is not running. Use 'devp up' first.`);
  }
  if (args.rest.length === 0) {
    die("No command specified. Usage: devp exec <command>");
  }

  const result = spawn("podman", ["exec", "-it", name, ...args.rest], {
    stdio: "inherit",
  });
  result.on("exit", (code) => process.exit(code ?? 0));
}

function cmdRebuild(args) {
  console.log(`Building ${args.image}...`);
  execSync(`podman build -t ${args.image} ${ROOT}`, { stdio: "inherit" });
}

function cmdBuild(args) {
  cmdRebuild(args);
}

async function cmdStatus(args) {
  const workspace = process.cwd();
  const name = containerName(workspace);

  // Auth
  const token = getAuthToken();
  if (token) {
    console.log(`Auth:      OK (${token.slice(0, 10)}...${token.slice(-4)})`);
  } else {
    console.log("Auth:      NOT FOUND");
  }

  // Proxy
  const proxyUp = await checkProxy(args.port);
  console.log(`Proxy:     ${proxyUp ? `running on :${args.port}` : "not running"}`);

  // Container
  const running = isContainerRunning(name);
  console.log(`Container: ${running ? `${name} (running)` : "not running"}`);
}

function cmdLogs() {
  const logFile = path.join(ROOT, "logs", "calls.jsonl");
  const result = spawn("tail", ["-f", logFile], { stdio: "inherit" });
  result.on("exit", (code) => process.exit(code ?? 0));
}

// Main
const args = parseArgs(process.argv.slice(2));

const commands = {
  up: cmdUp,
  down: cmdDown,
  shell: cmdShell,
  exec: cmdExec,
  rebuild: cmdRebuild,
  build: cmdBuild,
  status: cmdStatus,
  logs: cmdLogs,
};

if (!args.command) {
  console.log(USAGE);
  process.exit(0);
}

const handler = commands[args.command];
if (!handler) {
  die(`Unknown command: ${args.command}\n\n${USAGE}`);
}

await handler(args);
