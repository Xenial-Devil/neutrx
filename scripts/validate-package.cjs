"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

const rootDir = path.resolve(__dirname, "..");
const packageJson = readJson("package.json");
const failures = [];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
}

function normalizeTarget(target) {
  return target.replace(/^\.\//, "");
}

function requireFile(target, label = target) {
  const relativeTarget = normalizeTarget(target);
  if (!fs.existsSync(path.join(rootDir, relativeTarget))) {
    failures.push(`${label} missing: ${relativeTarget}`);
  }
}

function collectExportTargets(value, targets = new Set()) {
  if (typeof value === "string" && value.startsWith("./")) {
    targets.add(value);
    return targets;
  }

  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectExportTargets(child, targets);
  }

  return targets;
}

requireFile(packageJson.main, "main");
requireFile(packageJson.module, "module");
requireFile(packageJson.browser, "browser");
requireFile(packageJson.types, "types");

for (const target of collectExportTargets(packageJson.exports)) {
  requireFile(target, "exports target");
}

for (const target of ["dist/browser.mjs", "dist/adapters/browser.mjs"]) {
  const contents = fs.readFileSync(path.join(rootDir, target), "utf8");
  if (contents.includes("node:")) failures.push(`browser build imports Node core module: ${target}`);
}

const browserTypes = fs.readFileSync(path.join(rootDir, "dist/browser.d.ts"), "utf8");
if (browserTypes.includes("node:")) failures.push("browser types import Node core modules");

if (failures.length > 0) {
  console.error(failures.map(failure => `- ${failure}`).join("\n"));
  process.exit(1);
}

async function validateRuntime() {
  const nodeEsm = await import(pathToFileURL(path.join(rootDir, normalizeTarget(packageJson.module))).href);
  assert.equal(typeof nodeEsm.default, "function");
  assert.equal(nodeEsm.VERSION, packageJson.version);

  const requireFromRoot = createRequire(path.join(rootDir, "package.json"));
  const cjs = requireFromRoot(path.join(rootDir, normalizeTarget(packageJson.main)));
  assert.equal(typeof cjs, "function");
  assert.equal(typeof cjs.default, "function");
  assert.equal(cjs.VERSION, packageJson.version);

  const browser = await import(pathToFileURL(path.join(rootDir, normalizeTarget(packageJson.browser))).href);
  assert.equal(typeof browser.default, "function");
  assert.equal(browser.VERSION, packageJson.version);
}

function validatePackList() {
  const packArgs = ["pack", "--dry-run", "--json"];
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath && fs.existsSync(npmExecPath) ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmExecPath && fs.existsSync(npmExecPath) ? [npmExecPath, ...packArgs] : packArgs;
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32" && command.endsWith(".cmd"),
  });

  if (result.error || result.status !== 0) {
    console.error(result.error ?? result.stderr ?? result.stdout);
    process.exit(result.status ?? 1);
  }

  const pack = JSON.parse(result.stdout)[0];
  const files = new Set(pack.files.map(file => file.path));

  for (const target of [
    "README.md",
    "SECURITY.md",
    "THREATMODEL.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "MIGRATION_GUIDE.md",
    "CHANGELOG.md",
    "ROADMAP.md",
    "LICENSE",
    "package.json",
    normalizeTarget(packageJson.browser),
    normalizeTarget(packageJson.main),
    normalizeTarget(packageJson.module),
    normalizeTarget(packageJson.types),
  ]) {
    if (!files.has(target)) failures.push(`package tarball missing: ${target}`);
  }
}

validateRuntime()
  .then(() => {
    validatePackList();
    if (failures.length > 0) {
      console.error(failures.map(failure => `- ${failure}`).join("\n"));
      process.exit(1);
    }
    console.log(`Package ${packageJson.name}@${packageJson.version} validates.`);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
