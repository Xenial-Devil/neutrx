# Changelog

All notable changes to Neutrx are documented here.

This project uses Conventional Commits. Maintainers can preview generated release notes with `npm run changelog:preview`; the release workflow publishes GitHub release notes and updates this file from the same commit history.

## [Unreleased]

### Added

- Locked `conventional-changelog` as the local changelog generator.
- Added repeatable changelog preview/write scripts for maintainers.
- Added package validation for the adoption contract: MIT license, Node.js 18+ runtime, ESM/CJS entries, required trust docs, release workflow, and CI matrix.
- Added a full-stack and frontend migration guide covering adapter selection, the fetch adapter, browser builds, `NeutrxHeaders`, mutable defaults, interceptor options, richer progress events, and Axios workflow mappings.
- Added package validation for browser/full-stack adoption docs and export conditions.
- Added a Node infrastructure usage guide covering Docker sockets, local proxies, redirect hooks, decompression, encodings, absolute URL pinning, clarified timeout errors, `maxRate`, and utility methods.
- Added package validation for Node infrastructure adoption docs.

### Changed

- Declared `@opentelemetry/api` as an optional peer dependency so standard Neutrx installs do not pull in OpenTelemetry.
- Documented the release process so future GitHub releases include changelog updates, package validation, and release notes.
- Expanded browser and Axios migration docs so frontend and full-stack users can compare Neutrx directly with common Axios workflows.
- Expanded Node docs and examples for Docker, local proxy, infrastructure, and enterprise adoption workflows.

## [1.3.0](https://github.com/Xenial-Devil/neutrx/compare/v1.2.0...v1.3.0) - 2026-05-20

### Highlights

- Added CancelToken-compatible cancellation helpers for smoother Axios migrations.
- Added the validation plugin while keeping validator libraries optional and outside the runtime dependency tree.
- Expanded Axios comparison and migration documentation.
- Improved release workflow fixes around semantic-release environment handling.

### Bug Fixes

- Corrected `.releaserc` formatting and indentation.
- Updated semantic-release environment variables in the release workflow.

### Features

- Added cancellation support with CancelToken and the validation plugin.
- Added the Neutrx vs Axios competitive gap report and migration matrix.
- Added custom JSON parsing and stringifying options.
- Expanded RetryEngine tests for `Retry-After` and abort scenarios.

## [1.2.0](https://github.com/Xenial-Devil/neutrx/compare/v1.1.0...v1.2.0) - 2026-05-16

### Highlights

- Strengthened security profile behavior and corresponding test coverage.
- Expanded CI coverage across supported Node.js versions.

### Features

- Enhanced SecurityManager profiles and tests.
- Updated CI workflow and TypeScript module-resolution paths.

## [1.1.0](https://github.com/Xenial-Devil/neutrx/compare/v1.0.0...v1.1.0) - 2026-05-14

### Highlights

- Added redirect handling and response parsing foundations.
- Improved TypeScript module resolution with base URL and path configuration.

### Features

- Added redirect handling and response parsing.
- Updated TypeScript configuration for module resolution.

## [1.0.0](https://github.com/Xenial-Devil/neutrx/releases/tag/v1.0.0) - 2026-05-13

### Highlights

- Established Neutrx as a backend-first HTTP client for Node.js services.
- Added SSRF-aware DNS lookup and request size validation.
- Added custom adapters, proxy configuration, multipart/form-data serialization, and browser client foundations.
- Added resilience primitives: retry engine, circuit breaker, bulkhead, and rate limiter.
- Added the initial release workflow and CI integration.

### Features

- Added BrowserNeutrx client implementation.
- Enhanced NeutrxClient with DNS lookup and request size validation.
- Enhanced NeutrxClient with custom adapters, proxy configuration, and multipart/form-data serialization.
- Enhanced release workflow and CI integration.
- Implemented resilience patterns including Bulkhead, Circuit Breaker, Retry Engine, and Rate Limiter.
