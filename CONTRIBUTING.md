# Contributing

## Local Setup

```bash
npm ci
npm run validate
```

## Commit Format

Use Conventional Commits:

```text
feat: add fetch adapter
fix: preserve redirect headers safely
docs: update release notes
chore: refresh CI
```

Use `BREAKING CHANGE:` in commit body for incompatible API changes.

## Branches

- `feat/<short-name>`
- `fix/<short-name>`
- `docs/<short-name>`
- `chore/<short-name>`

## Pull Request Checklist

- Tests added or updated for behavior changes.
- `npm run validate` passes.
- Public API changes are reflected in `README.md` and `CHANGELOG.md`.
- Security-sensitive changes explain SSRF, header, redirect, or TLS impact.
