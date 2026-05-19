# Release Security

Neutrx's release path should match its security-first product claim.

## Current Controls

- Node.js 22, 24, and 25 CI.
- `npm ci`, lint, typecheck, tests, coverage, build, package validation, and packed-package smoke tests.
- `npm pack --dry-run` in CI and release workflow.
- Dependency Review and CodeQL workflows.
- Core package has zero required runtime dependencies.
- Project `.npmrc` sets `ignore-scripts=true`.

## Publishing Posture

The release workflow is configured for npm provenance and GitHub OIDC with `id-token: write`.

Do not add long-lived npm publishing tokens unless maintainers explicitly accept that tradeoff. Prefer npm trusted publishing for the `neutrx` package.

## Package Review

Before publishing, review:

```bash
npm pack --dry-run
npm run package:validate
npm run package:smoke
```

Package contents should include built `dist` output, docs, README, security docs, changelog, roadmap, threat model, license, and package metadata. It should not include local caches, tests output, credentials, or unpublished artifacts.

## Dependency Rule

Runtime dependencies remain empty unless a maintainer explicitly accepts a security and maintenance tradeoff. Dependency-heavy features belong in optional first-party packages.
