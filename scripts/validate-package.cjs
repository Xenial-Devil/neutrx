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
const requiredPackageDocs = [
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "THREATMODEL.md",
  "MIGRATION_GUIDE.md",
  "ROADMAP.md",
];
const requiredAdoptionDocs = [
  "docs/full-stack-frontend-migration.md",
  "docs/node-infrastructure.md",
  "docs/browser-usage.md",
  "docs/axios-migration.md",
  "docs/axios-migration-matrix.md",
  "docs/release-testing.md",
];

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

function readText(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`file missing: ${relativePath}`);
    return "";
  }

  return fs.readFileSync(absolutePath, "utf8");
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) failures.push(`${label} expected ${expected}, received ${actual}`);
}

function requireExport(keys, expected, label) {
  let actual = packageJson.exports;
  for (const key of keys) actual = actual?.[key];
  if (actual !== expected) failures.push(`${label} expected ${expected}, received ${actual}`);
}

function requireNoRuntimeDependencies() {
  for (const field of ["dependencies", "optionalDependencies"]) {
    const dependencies = packageJson[field];
    if (dependencies && Object.keys(dependencies).length > 0) {
      failures.push(`${field} must stay empty unless maintainers explicitly accept the runtime tradeoff`);
    }
  }
}

function requireOptionalPeerDependency(name, range) {
  requireEqual(packageJson.peerDependencies?.[name], range, `${name} peer dependency`);
  requireEqual(packageJson.peerDependenciesMeta?.[name]?.optional, true, `${name} optional peer metadata`);

  for (const field of ["dependencies", "optionalDependencies", "devDependencies"]) {
    if (packageJson[field]?.[name]) failures.push(`${name} must not be listed in ${field}`);
  }
}

function requireText(relativePath, expected, label = relativePath) {
  const contents = readText(relativePath);
  if (!contents.includes(expected)) failures.push(`${label} missing required text: ${expected}`);
}

function validateAdoptionContract() {
  requireEqual(packageJson.license, "MIT", "package license");
  requireEqual(packageJson.engines?.node, ">=18.0.0", "package engines.node");
  requireEqual(packageJson.type, "module", "package type");
  requireEqual(packageJson.main, "dist/index.cjs", "package main");
  requireEqual(packageJson.module, "dist/index.mjs", "package module");
  requireEqual(packageJson.browser, "dist/browser.mjs", "package browser");
  requireEqual(packageJson.types, "dist/index.d.ts", "package types");
  requireEqual(packageJson.scripts?.["release:validate"], "npm run ci", "release validation script");
  requireNoRuntimeDependencies();
  requireOptionalPeerDependency("@opentelemetry/api", ">=1.0.0 <2.0.0");

  for (const target of requiredPackageDocs) requireFile(target, "required package document");
  for (const target of requiredAdoptionDocs) requireFile(target, "required adoption document");

  requireText("LICENSE", "MIT License", "license file");
  requireText("LICENSE", "Permission is hereby granted, free of charge", "license file");
  requireText("README.md", "[![License: MIT]", "README license badge");
  requireText("README.md", "Node.js >=18", "README Node support");
  requireText("README.md", "CommonJS is supported too", "README CJS usage");
  requireText("README.md", "docs/full-stack-frontend-migration.md", "README full-stack frontend guide");
  requireText("README.md", "docs/node-infrastructure.md", "README Node infrastructure guide");
  requireText("CHANGELOG.md", "## [Unreleased]", "changelog");
  requireText("SECURITY.md", "GitHub private vulnerability reporting", "security policy");
  requireText("CONTRIBUTING.md", "MIT License", "contributing guide");

  requireExport([".", "browser", "default"], "./dist/browser.mjs", "root browser export");
  requireExport([".", "browser", "types"], "./dist/browser.d.ts", "root browser types export");
  requireExport(["./browser", "import"], "./dist/browser.mjs", "browser import export");
  requireExport(["./browser", "require"], "./dist/browser.cjs", "browser require export");
  requireExport(["./adapters", "browser"], "./dist/adapters/browser.mjs", "adapters browser export");
  requireExport(["./headers", "import"], "./dist/core/headers.mjs", "headers import export");
  requireExport(["./headers", "require"], "./dist/core/headers.cjs", "headers require export");

  for (const expected of [
    "Adapter Architecture",
    "Fetch Adapter And Browser Build",
    "NeutrxHeaders",
    "Mutable Defaults",
    "Interceptor Options",
    "Progress Events",
    "Axios Migration Map",
  ]) {
    requireText("docs/full-stack-frontend-migration.md", expected, "full-stack frontend migration guide");
  }

  for (const expected of [
    "socketPath",
    "Local Proxy",
    "beforeRedirect",
    "decompress",
    "responseEncoding",
    "allowAbsoluteUrls",
    "clarified timeout errors",
    "maxRate",
    "Utility Methods",
  ]) {
    requireText("docs/node-infrastructure.md", expected, "Node infrastructure guide");
  }

  for (const expected of [
    "npm run release:validate",
    "Node 18, 20, and 22",
    "neutrx/plugins",
    "neutrx/errors",
    "Browser And Edge Limits",
  ]) {
    requireText("docs/release-testing.md", expected, "release testing guide");
  }

  requireFile(".github/workflows/ci.yml", "CI workflow");
  requireFile(".github/workflows/release.yml", "release workflow");
  requireFile(".github/workflows/codeql.yml", "CodeQL workflow");
  requireFile(".github/workflows/dependency-review.yml", "Dependency Review workflow");
  requireFile(".releaserc", "semantic-release config");

  const ci = readText(".github/workflows/ci.yml");
  for (const version of ['"18"', '"20"', '"22"']) {
    if (!ci.includes(version)) failures.push(`CI matrix missing Node.js ${version}`);
  }
  for (const command of [
    "npm ci",
    "npm run lint",
    "npm run typecheck",
    "npm test",
    "npm run coverage",
    "npm run build",
    "npm run docs:build",
    "npm run package:validate",
    "npm run package:smoke",
  ]) {
    if (!ci.includes(command)) failures.push(`CI workflow missing command: ${command}`);
  }

  const release = readText(".github/workflows/release.yml");
  for (const expected of [
    "contents: write",
    "id-token: write",
    "semantic-release",
    "@semantic-release/github",
    "npm run docs:build",
    "npm run package:validate",
    "npm run package:smoke",
    "npm run changelog:preview",
  ]) {
    if (!release.includes(expected)) failures.push(`release workflow missing: ${expected}`);
  }
}

validateAdoptionContract();

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
    ...requiredPackageDocs,
    ...requiredAdoptionDocs,
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
