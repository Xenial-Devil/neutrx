# Codebase Analysis

- `tsconfig.json` uses `module: NodeNext` and `moduleResolution: NodeNext`.
- `src/version.ts` is the direct import site for `package.json`.
- Build scripts already rewrite the emitted ESM version file to use the JSON import attribute, so the source should match that runtime expectation.
