"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildSync } = require("esbuild");

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
  const installedManifest = JSON.parse(fs.readFileSync(path.join(tempDir, "node_modules", "neutrx", "package.json"), "utf8"));
  assert.equal(installedManifest.peerDependencies?.["@opentelemetry/api"], ">=1.0.0 <2.0.0");
  assert.equal(installedManifest.peerDependenciesMeta?.["@opentelemetry/api"]?.optional, true);
  assert.equal(
    fs.existsSync(path.join(tempDir, "node_modules", "@opentelemetry", "api")),
    false,
    "a normal Neutrx install must not install the optional OpenTelemetry peer"
  );
  const tempPackageJsonPath = path.join(tempDir, "package.json");
  const tempPackageJson = JSON.parse(fs.readFileSync(tempPackageJsonPath, "utf8"));
  fs.writeFileSync(tempPackageJsonPath, `${JSON.stringify({ ...tempPackageJson, type: "module" }, null, 2)}\n`);

  run(process.execPath, [
    "--input-type=module",
    "--eval",
    "const root = await import('neutrx'); const plugins = await import('neutrx/plugins'); const errors = await import('neutrx/errors'); if (typeof root.default !== 'function') throw new Error('missing default'); if (typeof plugins.OtelPlugin !== 'object') throw new Error('missing plugin subpath'); if (typeof errors.NeutrxError !== 'function') throw new Error('missing errors subpath');",
  ], { cwd: tempDir });

  run(process.execPath, [
    "--eval",
    "const root = require('neutrx'); const plugins = require('neutrx/plugins'); const errors = require('neutrx/errors'); if (typeof root !== 'function') throw new Error('missing cjs callable'); if (typeof root.default !== 'function') throw new Error('missing cjs default'); if (typeof plugins.OtelPlugin !== 'object') throw new Error('missing cjs plugin subpath'); if (typeof errors.NeutrxError !== 'function') throw new Error('missing cjs errors subpath');",
  ], { cwd: tempDir });

  const typesFixture = path.join(tempDir, "types-smoke.ts");
  fs.writeFileSync(typesFixture, [
    "import neutrx from 'neutrx';",
    "import { OtelPlugin, type NeutrxPlugin } from 'neutrx/plugins';",
    "import { NeutrxError } from 'neutrx/errors';",
    "const plugin: NeutrxPlugin = OtelPlugin;",
    "const client = neutrx.create();",
    "const error: NeutrxError = new NeutrxError('packed type smoke');",
    "void plugin; void client; void error;",
    "",
  ].join("\n"));
  run(process.execPath, [
    path.join(rootDir, "node_modules", "typescript", "bin", "tsc"),
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "false",
    "--target",
    "ES2023",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    typesFixture,
  ], { cwd: tempDir });

  const browserFixture = path.join(tempDir, "browser-smoke.mjs");
  const browserBundle = path.join(tempDir, "browser-bundle.mjs");
  fs.writeFileSync(browserFixture, "import neutrx from 'neutrx'; export const client = neutrx.create({ baseURL: 'https://example.com' });\n");
  const browserBuild = buildSync({
    absWorkingDir: tempDir,
    entryPoints: [browserFixture],
    bundle: true,
    conditions: ["browser"],
    format: "esm",
    logLevel: "silent",
    metafile: true,
    outfile: browserBundle,
    platform: "browser",
    tsconfigRaw: { compilerOptions: {} },
  });
  const browserOutput = fs.readFileSync(browserBundle, "utf8");
  const browserInputs = Object.keys(browserBuild.metafile.inputs).join("\n").replaceAll("\\", "/");
  assert.doesNotMatch(browserOutput, /node:/u, "browser bundle must not import Node core modules");
  assert.match(browserInputs, /node_modules\/neutrx\/dist\/browser\.mjs/u, "browser bundle must use the packed browser export");
  assert.match(browserOutput, /Certificate pinning is Node-only/u, "browser condition must select the browser client");

  console.log(`Packed package smoke test passed: ${packRecord.filename}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(tarball, { force: true });
}
