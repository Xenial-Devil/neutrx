# Contributing

Thank you for contributing to Neutrx. Neutrx is source-available under a restrictive license. Contributions are welcome, but forks are allowed only for contribution back to the original repository.

Publishing, redistributing, selling, rebranding, or releasing modified versions of Neutrx is not allowed without written permission from the project owner.

## Fork And Branch

1. Fork the repository only to prepare a contribution back to the original repository.
2. Create a focused branch:

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

Neutrx supports Node.js >=22. Use the current supported Node.js line before running tests or builds.

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
- Do not weaken SSRF, redirect, TLS, size-limit, or redaction behavior without maintainer approval.
- Keep runtime dependency changes minimal and justified.
- Add documentation when behavior, configuration, or migration guidance changes.

## Tests Required

Add or update tests for:

- New features.
- Bug fixes.
- Security-sensitive behavior.
- Public API changes.
- Retry, cache, interceptor, redirect, timeout, cancellation, or error handling changes.

Documentation-only changes may skip tests unless examples or generated output are affected.

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

## Pull Request Checklist

Before opening a pull request:

- Branch exists only to contribute back to the original repository.
- Scope is focused and explained.
- Tests are added or updated when behavior changes.
- `npm test` passes.
- `npm run build` passes.
- `npm run typecheck` passes.
- `npm run validate` passes when practical.
- Documentation is updated for user-visible changes.
- Security impact is described for URL, DNS, redirect, header, TLS, body-size, retry, cache, or error changes.
- No publishing, redistribution, selling, rebranding, or modified release is proposed without written permission.

## License And Rights

By contributing, you agree that your contribution may be included in Neutrx under the project license. Contribution credit does not grant publishing, distribution, sublicensing, rebranding, or release rights beyond the license terms and written permissions from the project owner.

