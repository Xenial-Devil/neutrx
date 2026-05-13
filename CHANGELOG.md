# Changelog

All notable changes to this project will be documented here.

This project follows Conventional Commits for future release notes.

## [Unreleased]

### Added

- Dual ESM/CJS package build outputs with shared declaration output.
- Built-in `fetch` adapter name and adapter export.
- `isNeutrxError(error)` type guard.
- `getUri(config)` helper for URL construction without dispatch.
- `socketPath` and `decompress` request/client config fields.
- Active CI and release-please workflows.

### Changed

- Interceptor `synchronous` option now runs synchronous request interceptors before async chain scheduling.
