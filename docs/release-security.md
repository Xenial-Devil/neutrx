# Release Security

Neutrx's release path should match its security-first product claim.

## Current Controls

- Node.js 18, 20, and 22 CI.
- `npm ci`, lint, typecheck, tests, coverage, build, package validation, and packed-package smoke tests.
- `npm pack --dry-run` in CI and release workflow.
- Locked `conventional-changelog` tooling for repeatable changelog previews and manual refreshes.
- `semantic-release` creates semver tags, updates `CHANGELOG.md`, and publishes GitHub release notes from Conventional Commits.
- Dependency Review and CodeQL workflows.
- Core package has zero required runtime dependencies.
- Project `.npmrc` sets `ignore-scripts=true`.

## Publishing Posture

The release workflow is configured for npm provenance and GitHub OIDC with `id-token: write`.

Do not add new long-lived npm publishing tokens unless maintainers explicitly accept that tradeoff. Prefer npm trusted publishing for the `neutrx` package; if a temporary `NPM_TOKEN` path is used during migration, keep it scoped to npm publish only and remove it once trusted publishing is verified.

## Changelog And GitHub Releases

`CHANGELOG.md` is part of the published npm package and should explain user-visible release highlights, not just raw commit subjects.

Maintainers can preview generated notes locally:

```bash
npm run changelog:preview
```

The canonical public release note surface is GitHub Releases. After a release, confirm:

- The `vX.Y.Z` tag exists locally and on GitHub.
- `https://github.com/Xenial-Devil/neutrx/releases/tag/vX.Y.Z` is visible.
- `CHANGELOG.md` contains the same version and a clear summary of major changes.
- The release workflow links to the successful validation run.

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
