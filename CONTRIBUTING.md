# Contributing

Thank you for contributing to Neutrx. Neutrx is open-source software licensed under the [MIT License](LICENSE). Contributions, forks, and downstream usage must follow the license terms.

## Project Scope

Neutrx is a backend-first HTTP client for Node.js 18+. Keep contributions aligned with secure service-to-service HTTP: SSRF protection, redirect safety, typed redacted errors, timeouts, retries, circuit breakers, cache metrics, and OpenTelemetry-friendly hooks.

Do not claim Neutrx is generally better than Axios. When comparing, be precise: Neutrx is security-focused and backend-first.

## Before Opening An Issue

Use public issues for bugs, feature requests, documentation gaps, migration pain points, and questions that do not contain secrets or vulnerability details.

Before opening an issue:

- Search existing issues and pull requests.
- Confirm the behavior on a supported Node.js runtime when possible.
- Include the Neutrx version, Node.js version, operating system, and a minimal reproduction.
- Redact tokens, cookies, authorization headers, URLs with credentials, customer data, internal hostnames, and logs that may expose secrets.
- Explain whether the report touches SSRF, redirects, DNS, TLS, request signing, redaction, size limits, timeouts, retries, circuit breaker, cache, or metrics behavior.

Do not report suspected vulnerabilities in public issues. Use the private process in [SECURITY.md](SECURITY.md).

## Pull Request Flow

Small, focused pull requests are easiest to review.

1. Open or reference an issue for significant API, security, compatibility, or behavior changes.
2. Create a branch from the current main development branch.
3. Add tests for behavior changes and security-sensitive paths.
4. Update docs, examples, and migration notes when user-facing behavior changes.
5. Explain the security and compatibility impact in the pull request description.
6. Run the relevant validation commands before requesting review.

## Create A Branch

Create a focused branch from the current main development branch:

```bash
git checkout -b fix/short-description
```

Use clear branch prefixes:

- `feat/short-description`
- `fix/short-description`
- `docs/short-description`
- `test/short-description`
- `chore/short-description`

## Install Dependencies

```bash
npm ci
```

Neutrx supports Node.js >=18. Use a supported runtime before running tests or builds.

## Run Tests

```bash
npm test
```

For coverage:

```bash
npm run coverage
```

## Build And Typecheck

```bash
npm run build
npm run typecheck
```

For full local validation:

```bash
npm run validate
```

## Coding Style

- Use TypeScript with strict types.
- Keep public API changes small, documented, and tested.
- Prefer explicit configuration over hidden behavior.
- Preserve security-first defaults.
- Do not weaken SSRF, redirect, TLS, size-limit, timeout, retry, circuit breaker, cache, metrics, or redaction behavior without maintainer approval.
- Avoid new runtime dependencies unless a maintainer explicitly accepts the tradeoff.
- Update documentation when behavior, configuration, or migration guidance changes.

## Tests Required

Add or update tests for:

- New features.
- Bug fixes.
- Security-sensitive behavior.
- Public API changes.
- Retry, cache, circuit breaker, interceptor, redirect, timeout, cancellation, or error handling changes.

Documentation-only changes may skip tests unless examples, generated output, or package contents are affected.

## Commit Messages

Use concise conventional-style messages:

```text
feat: add request option
fix: preserve timeout behavior
docs: update security policy
test: cover redirect handling
chore: refresh validation script
```

Use `BREAKING CHANGE:` in the commit body for incompatible public API changes.

## Release Process

Releases are maintainer-driven and automated from `main`.

1. Land changes with Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, and `BREAKING CHANGE:` when needed).
2. Before merging a release-bound change, run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run coverage`, `npm run build`, and `npm run package:validate` when practical.
3. Preview release notes locally with `npm run changelog:preview`.
4. Merge to `main`. The release workflow runs validation, updates `CHANGELOG.md`, creates the semver tag, publishes the npm package, and creates or updates the GitHub release notes.
5. Confirm the GitHub release is visible at `https://github.com/Xenial-Devil/neutrx/releases/tag/vX.Y.Z` and that `CHANGELOG.md` includes the released version.

Use `npm run changelog:write` only when a maintainer deliberately refreshes `CHANGELOG.md` outside the automated semantic-release path.

## Pull Request Checklist

Before opening a pull request:

- Branch is clean and contains only the necessary changes.
- Scope is focused and explained.
- Tests are added or updated when behavior changes.
- `npm test` passes.
- `npm run build` passes.
- `npm run typecheck` passes.
- `npm run validate` passes when practical.
- Documentation is updated for user-visible changes.
- Security impact is described for URL, DNS, redirect, header, TLS, body-size, timeout, retry, cache, circuit breaker, metrics, or error changes.


## License

By contributing, you agree that your contribution will be licensed under the project's [MIT License](LICENSE).
