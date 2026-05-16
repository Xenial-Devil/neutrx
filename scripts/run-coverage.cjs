"use strict";

const { spawnSync } = require("node:child_process");

const major = Number.parseInt(process.env.NEUTRX_COVERAGE_NODE_MAJOR ?? process.versions.node.split(".")[0] ?? "0", 10);
const testFiles = ["dist-tests/tests/**/*.test.js"];
const coverageSupported = major >= 22;

const args = coverageSupported
  ? ["--test", "--experimental-test-coverage", ...testFiles]
  : ["--test", ...testFiles];

if (!coverageSupported) {
  console.error(`Node ${process.versions.node} is unsupported. Neutrx requires Node.js >=22.0.0.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, args, {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
