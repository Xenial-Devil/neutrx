import { defineConfig } from 'tsup';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export default defineConfig({
    entry: sourceEntries('src'),
    format: ['esm', 'cjs'],
    target: 'node18',
    platform: 'node',
    bundle: true,
    splitting: false,
    sourcemap: true,
    clean: false,
    dts: true,
    cjsInterop: true,
    external: ['@opentelemetry/api'],
    outDir: 'dist',
    outExtension({ format }) {
        return {
            js: format === 'esm' ? '.mjs' : '.cjs',
        };
    },
    footer({ format }) {
        if (format !== 'cjs') return undefined;

        return {
            js: `
if (typeof module.exports.default === 'function') {
  const defaultExport = module.exports.default;
  for (const key of Object.keys(module.exports)) {
    if (key === 'default' || key in defaultExport) continue;
    Object.defineProperty(defaultExport, key, {
      value: module.exports[key],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(defaultExport, 'default', {
    value: defaultExport,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  module.exports = defaultExport;
}
`,
        };
    },
});

function sourceEntries(root: string): Record<string, string> {
    const entries: Record<string, string> = {};

    for (const file of walk(root)) {
        const name = relative(root, file).replace(/\\/g, '/').replace(/\.ts$/, '');
        entries[name] = file.replace(/\\/g, '/');
    }

    return entries;
}

function walk(dir: string): string[] {
    const files: string[] = [];

    for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) files.push(...walk(fullPath));
        else if (entry.endsWith('.ts')) files.push(fullPath);
    }

    return files;
}
