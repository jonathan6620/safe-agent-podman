#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAuthToken } from "../lib/auth.mjs";
import { checkProxy } from "../lib/proxy-check.mjs";
import {
  buildArgs,
  containerConfig,
  containerName,
  diffContainerConfig,
  envListToMap,
} from "../lib/container.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const USAGE = `Usage: devp <command> [options]

Commands:
  up [PATH]        Start proxy + container (default: current dir)
  down             Stop the running container
  rm               Remove a stopped container
  shell            Open a shell in the running container
  exec CMD...      Run a command in the running container
  rebuild          Rebuild the container image
  status           Show proxy and container status
  build            Build the container image
  logs             Tail proxy logs

Options:
  --image IMAGE       Container image (default: claude-sandbox)
  --model MODEL       Claude model (e.g. sonnet, opus, claude-sonnet-4-6)
  --no-bypass         Disable bypassPermissions (default: on)
  --allow-host HOST   Restrict network to Anthropic + HOST (repeatable)
  --safe-network      Allow package managers (apt, npm, pip, etc.) through firewall
  --log               Enable API call logging via host proxy
  --port PORT         Proxy port (default: 8080)
  -h, --help          Show this help
`;

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { command: null, rest: [], port: 8080, image: "claude-sandbox", model: null, allowHosts: [], bypass: true, safeNetwork: false, log: false };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--port") {
      args.port = parseInt(argv[++i], 10);
    } else if (a === "--image") {
      args.image = argv[++i];
    } else if (a === "--model") {
      args.model = argv[++i];
    } else if (a === "--allow-host") {
      args.allowHosts.push(argv[++i]);
    } else if (a === "--no-bypass") {
      args.bypass = false;
    } else if (a === "--safe-network") {
      args.safeNetwork = true;
    } else if (a === "--log") {
      args.log = true;
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
    const out = execFileSync(
      "podman",
      ["ps", "-a", "--filter", `name=^${name}$`, "--format", "{{.ID}}"],
      { encoding: "utf-8" }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

function isContainerRunning(name) {
  try {
    const out = execFileSync(
      "podman",
      [
        "ps",
        "--filter",
        `name=^${name}$`,
        "--filter",
        "status=running",
        "--format",
        "{{.ID}}",
      ],
      { encoding: "utf-8" }
    ).trim();
    return !!out;
  } catch {
    return false;
  }
}

function inspectContainerConfig(name) {
  try {
    const out = execFileSync(
      "podman",
      ["inspect", "--format", "{{json .}}", name],
      { encoding: "utf-8" }
    );
    const inspect = JSON.parse(out);
    return {
      image: inspect.ImageName || inspect.Config?.Image || null,
      env: envListToMap(inspect.Config?.Env ?? []),
    };
  } catch {
    return null;
  }
}

function formatConfigDiffs(diffs) {
  return diffs
    .map(({ key, actual, expected }) => {
      const current = actual ?? "(unset)";
      const desired = expected ?? "(unset)";
      return `${key}: current=${current} desired=${desired}`;
    })
    .join("\n  ");
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function ensureContainerMatchesConfig(name, args) {
  const actual = inspectContainerConfig(name);
  if (!actual) {
    return;
  }

  const desired = containerConfig({
    image: args.image,
    proxyPort: args.port,
    model: args.model,
    allowHosts: args.allowHosts,
    bypass: args.bypass,
    safeNetwork: args.safeNetwork,
    log: args.log,
  });
  const diffs = diffContainerConfig(actual, desired);

  if (diffs.length > 0) {
    const rmCommand = args.rest[0]
      ? `devp rm ${shellQuote(args.rest[0])}`
      : "devp rm";
    die(
      `Container ${name} was created with different settings.\n\n` +
        `  ${formatConfigDiffs(diffs)}\n\n` +
        `Remove it with '${rmCommand}' and run 'devp up' again.`
    );
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
  const existing = findContainer(name);

  if (isContainerRunning(name)) {
    console.log(`Container ${name} is already running. Attaching...`);
    attachShell(name);
    return;
  }

  // Restart existing stopped container, or create a new one
  if (existing) {
    ensureContainerMatchesConfig(name, args);
    if (args.log) {
      await ensureProxy(args.port);
    }
    console.log(`\nRestarting container ${name}...`);
    execFileSync("podman", ["start", name], { stdio: "ignore" });
  } else {
    if (args.log) {
      await ensureProxy(args.port);
    }
    console.log(`\nCreating container ${name}...`);
    console.log(`  Workspace: ${workspace}`);
    if (args.log) console.log(`  Logging:   :${args.port}`);
    console.log("");

    const runArgs = buildArgs({
      workspace,
      proxyPort: args.port,
      name,
      image: args.image,
      model: args.model,
      allowHosts: args.allowHosts,
      bypass: args.bypass,
      safeNetwork: args.safeNetwork,
      log: args.log,
    });

    execFileSync("podman", ["run", ...runArgs], { stdio: "ignore" });
  }

  // Wait for container to be running
  for (let i = 0; i < 10; i++) {
    if (isContainerRunning(name)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!isContainerRunning(name)) {
    die(`Container ${name} failed to start. Check 'podman logs ${name}'.`);
  }

  attachShell(name);
}

function attachShell(name) {
  const result = spawn("podman", ["exec", "-it", name, "zsh"], {
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

  if (!isContainerRunning(name)) {
    die(`Container ${name} is not running.`);
  }

  console.log(`Stopping ${name}...`);
  execFileSync("podman", ["stop", name], { stdio: "inherit" });
}

function cmdRm(args) {
  const workspace = path.resolve(args.rest[0] || process.cwd());
  const name = containerName(workspace);

  if (!findContainer(name)) {
    die(`No container found for ${name}`);
  }

  if (isContainerRunning(name)) {
    die(`Container ${name} is still running. Use 'devp down' first.`);
  }

  console.log(`Removing ${name}...`);
  execFileSync("podman", ["rm", name], { stdio: "inherit" });
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
  const build = spawn("podman", ["build", "-t", args.image, ROOT], {
    stdio: ["inherit", "inherit", "pipe"],
  });
  // Filter out rootless podman capability warnings
  build.stderr.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line && !line.includes("can't raise ambient capability")) {
        process.stderr.write(line + "\n");
      }
    }
  });
  build.on("exit", (code) => process.exit(code ?? 0));
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
  const exists = findContainer(name);
  if (running) {
    console.log(`Container: ${name} (running)`);
  } else if (exists) {
    console.log(`Container: ${name} (stopped)`);
  } else {
    console.log("Container: not created");
  }
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
  rm: cmdRm,
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
