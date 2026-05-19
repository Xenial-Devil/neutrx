import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PackageMetadata = { readonly version: string };

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as PackageMetadata;

export const VERSION = packageJson.version;
