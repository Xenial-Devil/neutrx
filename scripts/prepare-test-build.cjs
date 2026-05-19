"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const testPackageJson = path.join(rootDir, "dist-tests", "package.json");
const testVersionJs = path.join(rootDir, "dist-tests", "src", "version.js");

if (fs.existsSync(testVersionJs)) {
  const packageImport = '../package.json';
  const rootPackageImport = '../../package.json';
  let contents = fs.readFileSync(testVersionJs, "utf8");
  contents = contents.replaceAll(packageImport, rootPackageImport);
  fs.writeFileSync(testVersionJs, contents, "utf8");
}

fs.rmSync(testPackageJson, { force: true });
