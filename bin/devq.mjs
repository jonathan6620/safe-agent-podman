#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasCodexAuth } from "../lib/codex-auth.mjs";
import {
  buildArgs,
  containerConfig,
  containerName,
  diffContainerConfig,
  envListToMap,
} from "../lib/codex-container.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const USAGE = `Usage: devq <command> [options]

Commands:
  up [PATH]        Start Codex container (default: current dir)
  down             Stop the running container
  rm               Remove a stopped container
  shell            Open a shell in the running container
  exec CMD...      Run a command in the running container
  rebuild          Rebuild the Codex container image
  status           Show auth and container status
  build            Build the Codex container image

Options:
  --image IMAGE       Container image (default: codex-sandbox)
  --model MODEL       Codex model (for example gpt-5.1-codex-max or codex-mini-latest)
  --no-bypass         Keep Codex sandbox/approval controls enabled
  --allow-host HOST   Restrict network to OpenAI + HOST (repeatable)
  --safe-network      Allow package managers (apt, npm, pip, etc.) through firewall
  -h, --help          Show this help
`;

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    command: null,
    rest: [],
    image: "codex-sandbox",
    model: null,
    allowHosts: [],
    bypass: true,
    safeNetwork: false,
  };

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--image") {
      args.image = argv[++i];
    } else if (a === "--model") {
      args.model = argv[++i];
    } else if (a === "--allow-host") {
      args.allowHosts.push(argv[++i]);
    } else if (a === "--no-bypass") {
      args.bypass = false;
    } else if (a === "--safe-network") {
      args.safeNetwork = true;
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

function firewallLabel({ allowHosts, safeNetwork }) {
  if (allowHosts.length > 0 && safeNetwork) {
    return `safe-network + allow-host ${allowHosts.join(",")}`;
  }
  if (allowHosts.length > 0) {
    return `allow-host ${allowHosts.join(",")}`;
  }
  if (safeNetwork) {
    return "safe-network";
  }
  return "disabled (full access)";
}

function permissionsLabel(bypass) {
  if (bypass) {
    return "danger-full-access (container boundary)";
  }
  return "codex-managed";
}

function printStartupConfig(args, workspace) {
  const model = args.model ?? "default";

  console.log(`  Workspace:   ${workspace}`);
  console.log(`  Firewall:    ${firewallLabel(args)}`);
  console.log(`  Model:       ${model}`);
  console.log(`  Permissions: ${permissionsLabel(args.bypass)}`);
}

function ensureContainerMatchesConfig(name, args) {
  const actual = inspectContainerConfig(name);
  if (!actual) {
    return;
  }

  const desired = containerConfig({
    image: args.image,
    model: args.model,
    allowHosts: args.allowHosts,
    bypass: args.bypass,
    safeNetwork: args.safeNetwork,
  });
  const diffs = diffContainerConfig(actual, desired);

  if (diffs.length > 0) {
    const rmCommand = args.rest[0]
      ? `devq rm ${shellQuote(args.rest[0])}`
      : "devq rm";
    die(
      `Container ${name} was created with different settings.\n\n` +
        `  ${formatConfigDiffs(diffs)}\n\n` +
        `Remove it with '${rmCommand}' and run 'devq up' again.`
    );
  }
}

async function cmdUp(args) {
  const workspace = path.resolve(args.rest[0] || process.cwd());
  const name = containerName(workspace);
  const existing = findContainer(name);

  if (!hasCodexAuth()) {
    die(
      "No Codex auth found. Run 'codex login' on the host first, or set OPENAI_API_KEY."
    );
  }

  if (isContainerRunning(name)) {
    console.log(`Container ${name} is already running. Attaching...`);
    attachShell(name);
    return;
  }

  if (existing) {
    ensureContainerMatchesConfig(name, args);
    console.log(`\nRestarting container ${name}...`);
    printStartupConfig(args, workspace);
    console.log("");
    execFileSync("podman", ["start", name], { stdio: "ignore" });
  } else {
    console.log(`\nCreating container ${name}...`);
    printStartupConfig(args, workspace);
    console.log("");

    const runArgs = buildArgs({
      workspace,
      name,
      image: args.image,
      model: args.model,
      allowHosts: args.allowHosts,
      bypass: args.bypass,
      safeNetwork: args.safeNetwork,
    });

    execFileSync("podman", ["run", ...runArgs], { stdio: "ignore" });
  }

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
    die(`Container ${name} is still running. Use 'devq down' first.`);
  }

  console.log(`Removing ${name}...`);
  execFileSync("podman", ["rm", name], { stdio: "inherit" });
}

function cmdShell(args) {
  const workspace = path.resolve(args.rest[0] || process.cwd());
  const name = containerName(workspace);

  if (!isContainerRunning(name)) {
    die(`Container ${name} is not running. Use 'devq up' first.`);
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
    die(`Container ${name} is not running. Use 'devq up' first.`);
  }
  if (args.rest.length === 0) {
    die("No command specified. Usage: devq exec <command>");
  }

  const result = spawn("podman", ["exec", "-it", name, ...args.rest], {
    stdio: "inherit",
  });
  result.on("exit", (code) => process.exit(code ?? 0));
}

function cmdRebuild(args) {
  console.log(`Building ${args.image}...`);
  const build = spawn(
    "podman",
    ["build", "-f", path.join(ROOT, "Dockerfile.codex"), "-t", args.image, ROOT],
    {
      stdio: ["inherit", "inherit", "pipe"],
    }
  );
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

function cmdStatus() {
  const workspace = process.cwd();
  const name = containerName(workspace);

  console.log(`Auth:      ${hasCodexAuth() ? "OK" : "NOT FOUND"}`);

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
