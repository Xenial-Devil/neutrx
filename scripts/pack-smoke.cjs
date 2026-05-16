"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const npmCache = process.env.NEUTRX_NPM_CACHE ?? path.join(rootDir, ".tmp", "npm-cache");
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_"))
);
childEnv.npm_config_cache = npmCache;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: childEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32" && command.endsWith(".cmd"),
  });

  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || result.stdout || `${command} ${args.join(" ")} failed`);
  }

  return result.stdout;
}

function npm(args, cwd = rootDir) {
  const npmArgs = ["--cache", npmCache, ...args];
  if (process.platform === "win32") return run("cmd.exe", ["/d", "/s", "/c", "npm", ...npmArgs], { cwd });
  return run("npm", npmArgs, { cwd });
}

const packOutput = npm(["pack", "--json"]);
const packRecord = JSON.parse(packOutput)[0];
assert.ok(packRecord.filename, "npm pack must return a tarball filename");

const tarball = path.join(rootDir, packRecord.filename);
const tempRoot = process.env.NEUTRX_PACK_TMP ?? path.join(rootDir, ".tmp");
fs.mkdirSync(tempRoot, { recursive: true });
const tempDir = fs.mkdtempSync(path.join(tempRoot, "neutrx-pack-"));

try {
  npm(["init", "-y"], tempDir);
  npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], tempDir);

  run(process.execPath, [
    "--input-type=module",
    "--eval",
    "const root = await import('neutrx'); const node = await import('neutrx/node'); if (typeof root.default !== 'function') throw new Error('missing default'); if (root.VERSION !== node.VERSION) throw new Error('version mismatch');",
  ], { cwd: tempDir });

  run(process.execPath, [
    "--eval",
    "const root = require('neutrx'); const node = require('neutrx/node'); if (typeof root.default !== 'function') throw new Error('missing cjs default'); if (root.VERSION !== node.VERSION) throw new Error('cjs version mismatch');",
  ], { cwd: tempDir });

  console.log(`Packed package smoke test passed: ${packRecord.filename}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(tarball, { force: true });
}
