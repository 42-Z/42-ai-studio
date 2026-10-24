#!/usr/bin/env bun

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { watch, type FSWatcher } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const eveBin = resolve(root, "node_modules/eve/bin/eve.js");
const port = process.env.PORT ?? "3000";
const skipSandboxPrewarm = process.env.EVE_PREWARM !== "1";

let server: ChildProcess | undefined;
let building = false;
let queued = false;
let shuttingDown = false;

function log(message: string): void {
  console.log(`[dev] ${message}`);
}

function run(args: string[]): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolvePromise(code ?? (signal === null ? 0 : 1));
    });
  });
}

async function build(): Promise<boolean> {
  const args = [eveBin, "build"];
  if (skipSandboxPrewarm) {
    args.push("--skip-sandbox-prewarm");
  }

  log("building agent...");
  const code = await run(args);
  if (code !== 0) {
    log(`build failed with exit code ${code}`);
    return false;
  }

  return true;
}

async function stopServer(): Promise<void> {
  const child = server;
  if (!child) {
    return;
  }

  server = undefined;
  log("stopping server...");
  child.kill("SIGTERM");

  if (child.exitCode === null && child.signalCode === null) {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await once(child, "exit").catch(() => undefined);
    clearTimeout(timer);
  }
}

async function startServer(): Promise<void> {
  log(`starting server on http://localhost:${port}...`);
  const child = spawn(process.execPath, [eveBin, "start", "--port", port], {
    cwd: root,
    env: { ...process.env, PORT: port },
    stdio: "inherit",
  });

  server = child;
  child.once("exit", (code, signal) => {
    if (!shuttingDown && server === child) {
      server = undefined;
      log(`server exited (${code ?? signal ?? "unknown"})`);
    }
  });
}

async function rebuild(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  if (building) {
    queued = true;
    return;
  }

  building = true;
  try {
    await stopServer();
    if (await build()) {
      await startServer();
    } else {
      log("waiting for changes before retrying");
    }
  } catch (error) {
    log(`error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    building = false;
    if (queued) {
      queued = false;
      void rebuild();
    }
  }
}

function shouldRebuildAgentFile(filename: string): boolean {
  const normalized = filename.replaceAll("\\", "/");
  return (
    normalized !== ".DS_Store" &&
    !normalized.startsWith(".git/") &&
    !normalized.includes("/node_modules/") &&
    !normalized.endsWith("~")
  );
}

const watchers: FSWatcher[] = [
  watch(resolve(root, "agent"), { recursive: true }, (_event, filename) => {
    if (!filename || !shouldRebuildAgentFile(filename)) {
      return;
    }

    log(`change: agent/${filename}`);
    void rebuild();
  }),
  watch(root, { recursive: false }, (_event, filename) => {
    if (!filename) {
      return;
    }

    if (filename === "tsconfig.json" || filename.startsWith(".env")) {
      log(`change: ${filename}`);
      void rebuild();
    }
  }),
];

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  log(`received ${signal}, shutting down...`);
  for (const watcher of watchers) {
    watcher.close();
  }
  await stopServer();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await rebuild();
