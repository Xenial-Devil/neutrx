# [1.3.0](https://github.com/Xenial-Devil/neutrx/compare/v1.2.0...v1.3.0) (2026-05-20)


### Bug Fixes

* correct formatting and indentation in .releaserc configuration ([50bf8f6](https://github.com/Xenial-Devil/neutrx/commit/50bf8f61fd0623779c4ec4f9186e62b52d54dd99))
* update environment variables for semantic-release in release workflow ([845b1d8](https://github.com/Xenial-Devil/neutrx/commit/845b1d847d020f677a8919600c0f982c63ec0813))


### Features

* add cancellation support with CancelToken and validation plugin ([bff2614](https://github.com/Xenial-Devil/neutrx/commit/bff26148b4fa1a77d2265d9609379ca3134e5b61))
* add Neutrx vs Axios Competitive Gap Report and migration matrix ([46c7387](https://github.com/Xenial-Devil/neutrx/commit/46c7387aa004edbd6a9d95a54df529c65b07f1bc))
* enhance API with custom JSON parsing and stringifying options ([f658de2](https://github.com/Xenial-Devil/neutrx/commit/f658de2f83ede11705df8cb7a32a9dc31cd5b411))
* **tests:** enhance RetryEngine tests for Retry-After and abort scenarios ([97deeec](https://github.com/Xenial-Devil/neutrx/commit/97deeec5b01a58cfb4d68ab629ab26fdb2175159))

# [1.2.0](https://github.com/Xenial-Devil/neutrx/compare/v1.1.0...v1.2.0) (2026-05-16)


### Features

* enhance SecurityManager profiles and tests ([660abd5](https://github.com/Xenial-Devil/neutrx/commit/660abd536b79370b532bd37edfe45d99df519100))
* update CI workflow to include additional Node.js versions and enhance tsconfig paths ([3c287ed](https://github.com/Xenial-Devil/neutrx/commit/3c287ed8fb31a45bbc88d704f7d907d206ce62fa))

# [1.1.0](https://github.com/Xenial-Devil/neutrx/compare/v1.0.0...v1.1.0) (2026-05-14)


### Features

* add redirect handling and response parsing ([368878b](https://github.com/Xenial-Devil/neutrx/commit/368878b23e96c87815923e26f58f2132fbf8f506))
* update tsconfig.json with baseUrl and paths for module resolution ([388770f](https://github.com/Xenial-Devil/neutrx/commit/388770f44df6e460287b94911b38a67386a2af17))

# 1.0.0 (2026-05-13)


### Features

* add BrowserNeutrx client implementation ([11acbc1](https://github.com/Xenial-Devil/neutrx/commit/11acbc17e484c60c8ac4198d8ddc5bf4b6299bd9))
* enhance NeutrxClient with DNS lookup and request size validation ([34cd0ab](https://github.com/Xenial-Devil/neutrx/commit/34cd0aba5be071ae25540ecf22e91cf9febe68f1))
* enhance NeutrxClient with support for custom adapters, proxy configuration, and multipart/form-data serialization ([62d62eb](https://github.com/Xenial-Devil/neutrx/commit/62d62eb83650e6de47741c7aa1636eb65a3b2289))
* enhance release workflow and CI integration ([9d97929](https://github.com/Xenial-Devil/neutrx/commit/9d97929046e9dd64e4c7fb63a1d970ebae38ec32))
* implement resilience patterns including Bulkhead, Circuit Breaker, Retry Engine, and Rate Limiter ([ef08390](https://github.com/Xenial-Devil/neutrx/commit/ef083902d85d0f9d9f7786192638d94a60b6626d))

# Changelog

All notable changes to this project will be documented here.

This project follows Conventional Commits for future release notes.

## [Unreleased]

### Added

- Dual ESM/CJS package build outputs with shared declaration output.
- Built-in `fetch` adapter name and adapter export.
- Built-in adapter constants for explicit `http`, `fetch`, and `http2` selection.
- `isNeutrxError(error)` type guard.
- `getUri(config)` helper for URL construction without dispatch.
- `socketPath` and `decompress` request/client config fields.
- `maxRate` upload/download throttling config.
- `neutrx.defaults` global defaults object.
- `response.request` transport reference where adapters can expose it.
- Richer progress event fields: `bytes`, `rate`, `estimated`, `upload`, and `download`.
- Active CI and release-please workflows.

### Changed

- Interceptor `synchronous` option now runs synchronous request interceptors before async chain scheduling.
- Header normalization rejects prototype-pollution keys.
