"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const rootPackageJson = path.join(rootDir, "package.json");
const distPackageJson = path.join(distDir, "package.json");
const esmVersion = path.join(distDir, "esm", "version.js");
const cjsVersion = path.join(distDir, "cjs", "version.js");

fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(rootPackageJson, distPackageJson);

if (fs.existsSync(esmVersion)) {
  fs.writeFileSync(
    esmVersion,
    "import packageJson from '../package.json' with { type: 'json' };\n\nexport const VERSION = packageJson.version;\n",
    "utf8"
  );
}

if (fs.existsSync(cjsVersion)) {
  fs.writeFileSync(
    cjsVersion,
    '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.VERSION = void 0;\nconst packageJson = require("../package.json");\nexports.VERSION = packageJson.version;\n',
    "utf8"
  );
}
