# AGENTS.md

Guidance for Codex and other AI coding agents working in this repository.

## Product Direction

Neutrx is a secure-by-default HTTP client for Node.js 18+ backend services. Keep Axios-like ergonomics, but do not copy Axios blindly. Prefer backend safety, typed errors, observability, and resilience.

Use this positioning:

- Axios is more mature and more general-purpose.
- Neutrx should be better for secure Node.js backend service-to-service HTTP.
- Strongest differentiators: SSRF protection, redirect safety, retries, circuit breaker, cache metrics, typed redacted errors, and OpenTelemetry-friendly hooks.

## Constraints

- Do not add runtime dependencies unless a maintainer explicitly accepts the tradeoff.
- Keep Node.js `>=18.0.0`.
- Keep ESM, CJS, and declaration exports working.
- Security profiles are `strict`, `standard`, and `legacy`. Deprecated aliases may be supported for compatibility, but docs and examples should use canonical names.
- Do not weaken SSRF, redirect, redaction, size-limit, timeout, retry, circuit-breaker, cache, or metrics behavior without tests and documentation.
- Do not claim Neutrx is generally better than Axios. Be precise: backend-first and security-focused.

## Before Editing

Inspect:

- `package.json`
- `README.md`
- `docs/`
- `src/`
- `tests/`
- `.github/workflows/`
- `examples/`

Then make a short plan and keep changes scoped.

## Validation

Run available checks after changes:

- `npm ci`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run coverage`
- `npm run package:validate`

If a command is missing, report it. If a command fails, fix the cause or document the blocker.
