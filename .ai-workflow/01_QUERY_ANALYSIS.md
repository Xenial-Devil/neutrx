# Query Analysis

- User reported TypeScript error: importing JSON in an ECMAScript module requires `type: "json"` when `module` is `NodeNext`.
- Falsifiable hypothesis: `src/version.ts` imports `../package.json` without an import attribute.
- Cheap check: inspect the import line in `src/version.ts` and run a focused typecheck after patching.
