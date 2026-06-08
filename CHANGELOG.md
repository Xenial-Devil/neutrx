# [1.4.0](https://github.com/Xenial-Devil/neutrx/compare/v1.3.0...v1.4.0) (2026-06-08)


### Bug Fixes

* handle non-string websocket messages safely ([1111e2f](https://github.com/Xenial-Devil/neutrx/commit/1111e2f55e2d911eebf0672e0f1bcd6562bb5e87))
* update dist entry paths from esm to mjs ([b354f4d](https://github.com/Xenial-Devil/neutrx/commit/b354f4d8053439eef39b4bfb2909c40aeec6e080))


### Features

* add request deduplication and cache revalidation ([42455de](https://github.com/Xenial-Devil/neutrx/commit/42455dedae9420f39ee7c4893145141ad37e5ea7))
* add response schema validation support ([ac0abe5](https://github.com/Xenial-Devil/neutrx/commit/ac0abe56b6538990ca9d541c03c59a5d7cd1220a))
* add trace context plugin and cache management ([7419ffe](https://github.com/Xenial-Devil/neutrx/commit/7419ffee35d1226b23a29c0499e938177af430ca))
* expand docs and add support policy ([670e369](https://github.com/Xenial-Devil/neutrx/commit/670e369651c03e1ddb4aa8efacf03de5273bfd79))
* export error utilities and improve tracing ([25e2dcc](https://github.com/Xenial-Devil/neutrx/commit/25e2dcccd9d412426c2e2ea068637c1f16976c8f))
* make request deduplication enabled by default ([0ab7b39](https://github.com/Xenial-Devil/neutrx/commit/0ab7b397d2c539e6914cd9c9a7e43661ec4b7c1e))

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
