# Contributing

Thank you for contributing to Neutrx. Neutrx is open-source software licensed under the [MIT License](LICENSE). Contributions, forks, and downstream usage must follow the license terms.



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

Neutrx supports Node.js >=22. Use a supported runtime before running tests or builds.

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
