"use strict";

const { spawnSync } = require("node:child_process");

const major = Number.parseInt(process.env.NEUTRX_COVERAGE_NODE_MAJOR ?? process.versions.node.split(".")[0] ?? "0", 10);
const testFiles = ["dist-tests/tests/**/*.test.js"];
const coverageSupported = major >= 22;
const thresholds = {
  lines: process.env.NEUTRX_COVERAGE_LINES ?? "70",
  branches: process.env.NEUTRX_COVERAGE_BRANCHES ?? "55",
  functions: process.env.NEUTRX_COVERAGE_FUNCTIONS ?? "55",
};

const args = coverageSupported
  ? [
      "--test",
      "--experimental-test-coverage",
      "--test-coverage-include=dist/index.mjs",
      "--test-coverage-include=dist/browser.mjs",
      "--test-coverage-exclude=dist/**/*.cjs",
      "--test-coverage-exclude=dist/**/*.d.ts",
      `--test-coverage-lines=${thresholds.lines}`,
      `--test-coverage-branches=${thresholds.branches}`,
      `--test-coverage-functions=${thresholds.functions}`,
      ...testFiles,
    ]
  : ["--test", ...testFiles];

if (!coverageSupported) {
  console.warn(`Node ${process.versions.node} does not support the coverage thresholds used here; running tests without coverage.`);
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
