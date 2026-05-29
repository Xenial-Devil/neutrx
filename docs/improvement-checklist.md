# Neutrx Improvement Checklist

Purpose: turn the Axios gap analysis into a practical development checklist for improving Neutrx as an Axios alternative for secure Node.js backend egress.

Core goal: remove adoption blockers first, close useful Axios migration gaps second, then deepen security-first and observability-first differentiators.

## Adoption Blocker Status

| Item | Status | Decision |
| --- | --- | --- |
| License clarity | Done | Package uses MIT, includes `LICENSE`, and documents MIT in README/package metadata. |
| CommonJS build | Done | Package publishes dual ESM/CJS outputs and smoke-tests `require('neutrx')`. |
| Browser entry and fetch adapter | Done | Browser entry, package `browser` condition, and `fetch` adapter exist, with tests. Browser remains secondary. |
| Node.js >=18 support | Done | Package engines, build target, runtime smoke test, and CI matrix cover Node.js 18, 20, and 22. |
| Trust/community files | Done | README badges plus `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, roadmap, threat model, and release-security docs are packaged. |

## Phase 0: Trust And Packaging

- [x] Publish MIT license metadata and `LICENSE`.
- [x] Include trust docs in npm package contents.
- [x] Add CI, npm, license, Node, and runtime dependency badges.
- [x] Validate ESM, CJS, browser, and subpath exports from built output.
- [x] Keep `.npmrc` script-blocking posture documented in release security docs.
- [ ] Add signed/provenance release badge only after trusted publishing is live and verified.
- [ ] Add GitHub release note template that repeats security, runtime, and package validation status.

## Phase 1: Axios Migration Parity

- [x] Document Axios migration matrix.
- [x] Support `auth: { username, password }`.
- [x] Support indexed params serialization modes.
- [x] Support `CancelToken` bridge while recommending `AbortController`.
- [x] Support URL-encoded form helpers.
- [x] Document and test interceptor order.
- [ ] Add more focused "unsafe Axios pattern to safe Neutrx pattern" recipes.
- [ ] Consider a separate `neutrx/axios-compat` entry only if demand appears; keep core security posture unchanged.

## Phase 2: Security Proof

- [x] Document adapter security contract.
- [x] Add secure custom adapter wrapper tests.
- [x] Test DNS SSRF with unsafe custom lookup results.
- [x] Test mixed DNS answers where any unsafe answer blocks.
- [x] Test redirect credential stripping and downgrade/private redirect blocking.
- [x] Test URL credential confusion and IDN allow-list normalization.
- [ ] Add a persistent fuzz corpus for URL/IP parser edge cases.
- [ ] Add CRLF/header-injection corpus tests.
- [ ] Add redaction snapshots for nested JSON, GraphQL errors, OAuth token responses, and custom sensitive fields.

## Phase 3: Backend Policy And Resilience

- [x] Add `egressPolicy` modes and tests for protocol, port, redirect, public DNS, CIDR, and SNI checks.
- [x] Add request deduplication for in-flight `GET` and `HEAD`.
- [x] Add stale-while-revalidate, conditional revalidation, and stale-if-error cache behavior.
- [x] Add cache adapter locks for refresh coordination.
- [x] Add shared retry budget store interface.
- [x] Add shared circuit state store interface.
- [x] Add adaptive concurrency behind opt-in config.
- [ ] Design optional Redis cache and resilience packages outside core.
- [ ] Add production guide for multi-process retry budget and circuit state.

## Phase 4: Observability And Operations

- [x] Add metrics snapshot and Prometheus output.
- [x] Add OpenTelemetry-friendly instrumentation.
- [x] Add `OtelPlugin`, `LogPlugin`, and structured log tests.
- [x] Add Grafana starter dashboard.
- [ ] Add operations recipes for Express, Fastify, and NestJS services.
- [ ] Add dashboard docs that map metrics to SLO questions.
- [ ] Add release note checklist for observability-sensitive changes.

## Phase 5: Docs, Examples, And Public Proof

- [x] Add `why-neutrx.md` with precise positioning against Axios/fetch/Got/Ky.
- [x] Add backend recipes directory.
- [x] Add production service client example.
- [x] Add package contents validation.
- [ ] Add reproducible benchmark protocol with environment, Node version, commit, and commands.
- [ ] Add docs-site generation or TypeDoc plan.
- [ ] Add OpenAPI typed client generator design doc.

## Guardrails

- Do not claim Neutrx is generally better than Axios.
- Do not make browser support the main product surface.
- Do not add runtime dependencies to core without maintainer approval.
- Do not relax Node.js below `>=18.0.0` while repository policy says to keep Node 18+.
- Do not weaken SSRF, redirect, redaction, timeout, retry, circuit breaker, cache, or metrics behavior without tests and docs.
