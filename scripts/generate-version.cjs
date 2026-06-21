#!/usr/bin/env node
'use strict';

/**
 * Single source of truth for the package version is package.json.
 *
 * This script bakes package.json's `version` into src/version.ts as a plain
 * string literal at build time. Doing it at build time (not runtime) avoids the
 * two approaches that previously drifted or broke:
 *   - `import pkg from '../package.json'`  -> breaks the dual ESM/CJS + types build
 *   - `readFileSync(process.cwd()/package.json)` -> reads the *consumer's*
 *     package.json at runtime, not Neutrx's
 *
 * It runs as `prebuild`, so every `npm run build` (including the build that
 * `prepack` triggers at publish time) regenerates the literal from the current
 * package.json. After a release bumps package.json, the published dist always
 * carries the matching version — it can no longer be "one step old".
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version;

if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`generate-version: invalid version in package.json: ${String(version)}`);
  process.exit(1);
}

const target = path.join(rootDir, 'src', 'version.ts');
const next =
  '// AUTO-GENERATED — do not edit. Source of truth: package.json "version".\n' +
  '// Regenerated from package.json by scripts/generate-version.cjs on every build.\n' +
  `export const VERSION = ${JSON.stringify(version)};\n`;

// Only write when changed, to avoid needless mtime churn / git noise.
const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
if (current !== next) {
  fs.writeFileSync(target, next, 'utf8');
  console.log(`generate-version: src/version.ts -> ${version}`);
} else {
  console.log(`generate-version: src/version.ts already ${version}`);
}
