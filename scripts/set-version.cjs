"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-version.cjs <semver>");
  process.exit(1);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
}

function writeJson(relativePath, data) {
  fs.writeFileSync(path.join(rootDir, relativePath), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function replaceInFile(relativePath, replacements) {
  const filePath = path.join(rootDir, relativePath);
  let contents = fs.readFileSync(filePath, "utf8");

  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(contents)) {
      throw new Error(`Pattern not found in ${relativePath}: ${pattern}`);
    }
    contents = contents.replace(pattern, replacement);
  }

  fs.writeFileSync(filePath, contents, "utf8");
}

const packageJson = readJson("package.json");
packageJson.version = version;
writeJson("package.json", packageJson);

const lockJson = readJson("package-lock.json");
lockJson.version = version;
if (lockJson.packages?.[""]) {
  lockJson.packages[""].version = version;
  lockJson.packages[""].engines = packageJson.engines;
}
writeJson("package-lock.json", lockJson);

replaceInFile("src/version.ts", [
  [/export const VERSION = '[^']+';/, `export const VERSION = '${version}';`],
]);

console.log(`Set Neutrx version to ${version}`);
