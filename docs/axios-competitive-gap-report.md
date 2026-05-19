# Neutrx vs Axios Competitive Gap Report

Date: 2026-05-19

## Executive Verdict

Neutrx already has a sharp product wedge: secure Node.js 22+ backend service-to-service HTTP. It should not try to become a general-purpose Axios clone. Axios is more mature, more widely adopted, and broader across browser, Node.js, React Native, Bun, Deno, ecosystem examples, and compatibility habits.

Neutrx can win in a narrower and stronger category:

> Best secure-by-default HTTP client for modern Node.js backend egress.

To reach that goal, Neutrx needs more than features. It needs security proof, release trust, ecosystem-quality docs, compatibility migration paths, and advanced backend controls that Axios does not aim to provide by default.

## Current Position

### Neutrx Strengths

Neutrx already includes several backend-first features Axios does not provide as default first-class posture:

- SSRF protection with private IP, loopback, link-local, metadata, IPv4 variant, IPv6, IPv4-mapped IPv6, allow-list, and deny-list checks.
- DNS answer validation and pinned lookup for the Node HTTP adapter.
- Redirect safety with credential stripping and HTTPS downgrade protection.
- Typed redacted error classes.
- Built-in retry engine with jitter, retry budgets, `Retry-After`, deadline, and abort handling.
- Circuit breaker and bulkhead isolation.
- In-memory cache, request deduplication, stale-while-revalidate, and cache metrics.
- Metrics snapshot, Prometheus output, events, and optional OpenTelemetry bridge without runtime dependency.
- OpenTelemetry HTTP client semantic attributes with query-string-safe defaults and opt-in body size recording.
- ESM, CJS, browser, and subpath exports.
- Node 22+ only, zero runtime dependencies, and modern native API posture.
- HTTP, fetch, and HTTP/2 adapters.
- OAuth2, GraphQL, and mock plugins.
- Idempotency-key helper for retry-safe `POST`/`PATCH` when upstream APIs support duplicate suppression.
- Node TLS policy hooks for CA, mTLS client cert/key, SNI, and SHA-256 certificate pins with rotation windows.
- Cache adapter interface with per-key refresh locks for stale-while-revalidate extension points.
- Adaptive concurrency behind opt-in bulkhead config.
- HTTP/2 stream limits, GOAWAY session retirement, session stats, and Neutrx-managed redirect validation.
- Shared retry budget and circuit state store interfaces for fleet-safe resilience without core runtime dependencies.
- Service discovery resolver with round-robin, random, sticky-origin load balancing, and endpoint metadata.

### Axios Strengths

Axios remains strong because it has:

- Huge adoption, long history, and ecosystem familiarity.
- Broad browser and Node.js support.
- Interceptors, transforms, cancellation, automatic JSON, form serialization, XSRF, progress, rate limiting, proxy support, and adapter selection.
- Mature docs, examples, public website, release cadence, and community search footprint.
- Stable migration target in many applications.
- Runtime compatibility beyond the latest Node.js line.

### Main Strategic Gap

Neutrx has strong primitives, but it needs proof and packaging around them:

- More adversarial security testing.
- More explicit security contract for adapters and plugins.
- More production-grade distributed resilience options.
- More release and supply-chain hardening.
- Better documentation, examples, benchmarks, and migration tools.
- Clear "why choose Neutrx over Axios for backend egress" story.

## Comparison Matrix

| Area | Axios | Neutrx today | Neutrx target |
| --- | --- | --- | --- |
| Product scope | General HTTP client for browser and Node.js | Backend-first Node 22+ client, browser secondary | Best secure backend egress client |
| Runtime dependencies | Uses runtime deps for redirects, forms, proxies | Zero runtime deps | Keep core zero deps; optional plugins separate |
| Browser maturity | Strong, primary use case | Supported but secondary | Good enough, not main differentiator |
| SSRF protection | Not default product feature | Strong default controls | Audited policy engine with fuzz tests |
| Redirect security | General redirect support | Credential stripping and downgrade blocking | Full h1/h2 redirect policy contract |
| Retry | Userland or interceptor pattern | Built in | Adaptive retry budgets and cross-process policy |
| Circuit breaker | Userland | Built in | Distributed and observable circuit state |
| Cache | Userland | Built-in process cache | Pluggable process/distributed cache |
| Observability | Userland/interceptors | Metrics, events, optional OTEL bridge | OTEL semantic conventions and first-party plugin |
| Typed errors | AxiosError | Typed Neutrx errors with redaction | Stable error taxonomy and migration mapping |
| Docs/ecosystem | Mature | Good but small | Recipes, policy guide, threat model, docs site |
| Release trust | Mature but has supply-chain lessons | CI/release present | Provenance, script blocking, reproducible package proof |

## Missing Features Compared With Axios

These are not all features Neutrx must copy. They are gaps users will notice when migrating.

| Gap | Why it matters | Recommendation |
| --- | --- | --- |
| Full Axios compatibility guide | Users expect config names, error behavior, interceptor order, response shape, and progress semantics to map cleanly | Add "Axios migration parity matrix" with exact same/different behavior |
| `auth` request config | Axios users know `auth: { username, password }` | Add per-request `auth` alias that maps to safe header builder; redact it |
| URL-encoded form helpers | Axios supports automatic `application/x-www-form-urlencoded` paths | Add `postUrlEncoded`, `putUrlEncoded`, `patchUrlEncoded` or explicit serializer docs |
| Params serializer edge compatibility | Axios users rely on array index modes and custom encode helpers | Document current behavior; add tests for `indexes: true/false/null`, nested params, spaces, unicode |
| Browser confidence | Axios has broad browser story | Add real browser CI with Playwright for browser entry, XSRF, progress, abort, FormData |
| React Native/Bun/Deno statement | Axios documents broader runtime support | Decide explicit stance: unsupported, best effort, or smoke-tested |
| CancelToken compatibility | Axios old users may still have it | Do not add to core unless needed; provide migration note to `AbortController` |
| Interceptor execution contract | Axios users know LIFO request/FIFO response | Document Neutrx behavior with tests and migration notes |
| Rich docs website | Axios has searchable docs | Add generated docs site from Markdown or TypeDoc output |
| Ecosystem adapters/plugins | Axios has many userland adapters/interceptors | Publish plugin API guide and security contract |

## Missing Backend-First Features

These matter more than Axios parity for becoming "best" in Neutrx's chosen category.

| Priority | Feature | Why it matters | How to build |
| --- | --- | --- | --- |
| P0 | Release provenance and script blocking | Secure HTTP client must have secure supply chain | Add `.npmrc` with `ignore-scripts=true`; migrate release to npm trusted publishing/provenance; remove long-lived `NPM_TOKEN` path when ready |
| P0 | Security disclosure contact | Users need private reporting path | Add concrete email or GitHub Security Advisory instructions in `SECURITY.md` |
| P0 | Adapter security contract | Custom adapters can bypass redirect/DNS semantics | Document required adapter invariants; add `createSecureAdapter()` wrapper or validation hooks |
| P0 | Fuzz/property security tests | SSRF bypasses hide in URL/IP/parser edge cases | Add fuzz corpus for URL, IDN, IPv4 variants, IPv6, redirect locations, headers, body depth |
| P1 | Policy engine | Enterprises need repeatable egress policy | Add `egressPolicy` config: allowed CIDRs, denied CIDRs, required HTTPS, allowed ports, allowed SNI, metadata blocks |
| P1 | mTLS and certificate policy | Service-to-service traffic often needs identity | Implemented in core: cert/key/ca, SNI, pin sets with rotation windows |
| P1 | Distributed cache adapter | Process cache is not enough in multi-instance services | Add optional `@neutrx/cache-redis` package with peer dependency, not core dependency |
| P1 | Distributed retry/circuit budget | Retry storms happen across pods, not one process | Core interfaces implemented; optional Redis plugin remains outside core |
| P1 | Adaptive concurrency | Prevent overload better than static bulkheads | Implemented behind opt-in `resilience.adaptiveConcurrency` |
| P1 | HTTP/2 production controls | Backend clients need session lifecycle clarity | Partially implemented: GOAWAY session retirement, session stats, max stream controls, redirect policy tests |
| P1 | OTEL semantic conventions | Observability needs standard attributes and metrics | Implemented in core bridge: safe HTTP client semantic span attributes, retry/cache/service endpoint attrs, opt-in body sizes |
| P2 | OpenAPI typed client generator | Strong typed service clients drive adoption | Provide generator as dev-time tool; no core runtime dependency |
| P2 | ETag revalidation and stale-if-error | Cache should be safe and useful during outages | Implemented: conditional headers, stale-if-error fallback, warning headers |
| P2 | Request idempotency keys | Safe retries for POST need app help | Implemented: `idempotencyKey` helper and explicit retry opt-in for unsafe methods |
| P2 | Service discovery/load balancing | Backend services call pools of endpoints | Implemented in core: static or async resolver, weighted endpoints, round-robin/random/sticky-origin selection |
| P2 | Proxy and SOCKS plugin story | Enterprise networks need this | Keep core HTTP proxy; add optional SOCKS/PAC plugins if maintainers accept deps |
| P2 | Docs site and recipes | Adoption needs copy-paste clarity | Add task recipes: webhooks, internal API client, OAuth2, retries, OTEL, SSRF-safe URL fetch |
| P3 | HTTP/3/QUIC research | Future edge, not required now | Track Node support; design adapter boundary first |

## Product Goal

### North Star

Neutrx should become the HTTP client a backend team chooses when outbound traffic is a security boundary.

### Clear Promise

"Axios-like ergonomics for Node.js backends, with SSRF protection, redirect safety, redacted typed errors, retries, circuit breaking, cache metrics, and observability built in."

### Non-Goals

- Do not claim Neutrx is generally better than Axios.
- Do not make browser support the main product.
- Do not add heavy runtime dependencies to core.
- Do not chase deprecated Axios APIs unless migration data proves need.
- Do not weaken security profiles to improve compatibility.

## Recommended Architecture

### Core Package

Keep `neutrx` small, zero-runtime-dependency, secure by default:

- Request API.
- Config merge.
- Headers.
- Node HTTP/fetch/HTTP2 adapters.
- Security manager.
- Retry/circuit/bulkhead.
- Process cache.
- Metrics and events.
- Typed errors.
- Plugin hooks.

### Optional First-Party Packages

Use separate packages for dependency-heavy features:

- `@neutrx/otel`: OpenTelemetry API integration and semantic metrics.
- `@neutrx/cache-redis`: Redis cache adapter.
- `@neutrx/resilience-redis`: shared retry budgets and circuit state.
- `@neutrx/openapi`: code generator for typed API clients.
- `@neutrx/policy`: reusable egress policy presets.
- `@neutrx/testing`: mock server, fixtures, and security test helpers.

This keeps the core clean while giving production teams serious tools.

## Implementation Roadmap

### Phase 0: Trust And Positioning

Goal: make Neutrx credible before adding many features.

Tasks:

- Add `docs/why-neutrx.md`: direct comparison with Axios, Got, Undici/fetch, and Ky. Be precise.
- Add `docs/axios-migration-matrix.md`: config-by-config mapping.
- Add concrete vulnerability contact in `SECURITY.md`.
- Add `.npmrc` with `ignore-scripts=true`.
- Update release workflow toward npm trusted publishing/provenance.
- Add package provenance notes to README release section.
- Add threat model examples for real risks: webhook SSRF, redirect credential leak, metadata IP leak, retry storm.

Acceptance:

- User can understand when to choose Neutrx in under 2 minutes.
- Security team can understand reporting and release trust path.
- `npm pack --dry-run` package contents are documented.

### Phase 1: Security Proof

Goal: prove core security claims against adversarial inputs.

Tasks:

- Add URL/IP fuzz fixtures:
  - decimal/octal/hex IPv4
  - mixed-case IDN/punycode
  - IPv4-mapped IPv6
  - encoded credentials
  - redirect `Location` confusion
  - CRLF header injection
  - dangerous ports
- Add DNS rebinding simulation tests:
  - first lookup public then redirect to private
  - custom lookup returns private
  - multiple A/AAAA answers with one unsafe address
- Add tests for custom adapter security documentation examples.
- Add redaction snapshot tests for headers, params, nested JSON, GraphQL errors, OAuth token responses.

Acceptance:

- Every security claim in README has a matching test.
- Every way to relax security has a warning and test.
- Custom adapter docs clearly say what Neutrx can and cannot protect.

### Phase 2: Backend Policy Engine

Goal: make secure egress configurable like infrastructure policy.

Tasks:

- Add `egressPolicy` config:
  - `allowedHosts`
  - `deniedHosts`
  - `allowedCidrs`
  - `deniedCidrs`
  - `allowedPorts`
  - `requireHttps`
  - `allowRedirectsTo`
  - `blockCloudMetadata`
  - `requirePublicDns`
- Support policy presets:
  - `public-api`
  - `internal-service`
  - `webhook-target`
  - `legacy-migration`
- Add per-policy audit output:
  - effective policy
  - blocked reason code
  - safe log form

Acceptance:

- A security engineer can review one policy object and know allowed egress.
- A blocked request gives an actionable typed error.
- Policy docs include examples for user-controlled URLs and internal service URLs.

### Phase 3: Production Resilience

Goal: move from single-process resilience to fleet-safe resilience.

Tasks:

- Add cache adapter interface:
  - `get`
  - `set`
  - `delete`
  - `clear`
  - `lock` for stale-while-revalidate
- Add stale-if-error and ETag revalidation.
- Add shared retry budget interface.
- Add circuit state storage interface.
- Add adaptive concurrency controller.
- Add origin-level dashboard metrics:
  - current circuit state
  - active/queued bulkhead
  - retry budget remaining
  - cache hit/stale/error
  - h2 session streams

Acceptance:

- Same API works in one process and multi-instance deployment.
- Optional Redis package handles shared cache/resilience without core dependency.
- Retry storm mitigation can be explained and tested.

### Phase 4: Developer Experience

Goal: make migration and daily usage easy.

Tasks:

- Add recipes:
  - secure webhook fetcher
  - internal API client
  - OAuth2 client credentials
  - GraphQL client
  - OpenTelemetry tracing
  - Prometheus endpoint
  - streaming download with size limit
  - SSRF-safe URL preview
- Add Axios migration examples:
  - interceptors
  - `validateStatus`
  - `throwHttpErrors: false`
  - progress
  - FormData
  - AbortController
  - proxies
- Add TypeDoc or generated API reference.
- Add `examples/production-service-client.ts`.
- Consider `neutrx/axios-compat` as a separate compatibility layer.

Acceptance:

- A backend developer can migrate common Axios usage in one sitting.
- Docs show safe defaults first.
- Examples never use `legacy` except explicitly marked trusted local/migration cases.

### Phase 5: Performance And Public Proof

Goal: publish honest performance and package evidence.

Tasks:

- Create reproducible benchmark protocol:
  - local server
  - keep-alive
  - JSON body
  - streaming response
  - cache hit
  - retry path
  - high concurrency
- Compare against native fetch/Undici and Axios only when installed by caller.
- Publish numbers with environment, Node version, commit, and command.
- Add package size and dependency tree report.
- Add CI job for benchmark smoke, not full benchmark gate.

Acceptance:

- Benchmark docs are reproducible.
- No fake "fastest" claims.
- Claims remain backend-specific and measurable.

## Best Advanced Features To Add

### 1. Secure Egress Policy Engine

This is the biggest differentiator. Many backends need to fetch URLs influenced by users, webhooks, integrations, or partner APIs. Axios leaves policy to userland. Neutrx can make policy explicit.

Design:

```ts
const client = neutrx.create({
  security: { profile: 'strict' },
  egressPolicy: {
    mode: 'webhook-target',
    allowedProtocols: ['https'],
    deniedCidrs: ['0.0.0.0/8', '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16'],
    allowedPorts: [443],
    maxRedirects: 2,
  },
});
```

Tests:

- CIDR parser edge cases.
- IPv4/IPv6 canonicalization.
- DNS answers with mixed public/private addresses.
- Redirects into denied CIDRs.
- Error code and safe log output.

### 2. Distributed Resilience Plugins

Single-process retry budget/circuit/cache is useful, but production systems run many pods. Shared state prevents fleet-wide retry storms.

Design:

```ts
const api = neutrx.create({
  resilience: {
    enableRetry: true,
    enableCircuitBreaker: true,
    retryBudget: { maxRetries: 1000, windowMs: 60_000 },
  },
});

api.use(redisRetryBudget({ client: redis, namespace: 'billing-api' }));
api.use(redisCircuitState({ client: redis, namespace: 'billing-api' }));
```

Keep Redis code outside core.

### 3. First-Class OpenTelemetry Package

Current optional bridge is good. Production users need stable semantic attributes, metrics, and examples.

Target:

- Spans for every attempt and parent request.
- Attributes without secret query strings.
- Metrics for duration, active requests, retries, cache hit, circuit open, bulkhead queued.
- Trace propagation opt-in.
- Docs for Express/Fastify/NestJS services.

### 4. OpenAPI Typed Client Generator

This gives Neutrx a DX advantage without bloating runtime.

Target:

- Generate typed clients from OpenAPI.
- Use Neutrx config and security profiles.
- Per-operation typed request/response.
- Optional runtime validation via user-provided validator.
- Redaction metadata generated from schema names like `token`, `secret`, `password`.

### 5. HTTP/2 Production Hardening

HTTP/2 support should become a real backend feature:

- ALPN negotiation option.
- Session pool per origin.
- GOAWAY and REFUSED_STREAM retry logic for idempotent methods.
- Max concurrent streams.
- Session idle timeout.
- Session metrics.
- Redirect behavior documented and tested.

### 6. Cache Revalidation

Current cache is good but can become production-grade:

- ETag / `If-None-Match`.
- `Last-Modified` / `If-Modified-Since`.
- `stale-if-error`.
- `Vary` header handling or explicit safe limitation.
- Pluggable cache stores.

### 7. Migration Tooling

Neutrx should reduce adoption friction:

- `docs/axios-migration-matrix.md`.
- Codemod for common imports and config fields.
- Error mapping guide.
- "Unsafe Axios pattern -> safe Neutrx pattern" recipes.

## Testing Strategy

Required suites:

- Unit tests for config, headers, serializers, errors, policy engine.
- Integration tests with local HTTP/HTTPS servers.
- DNS tests with custom lookup and multi-answer simulation.
- Redirect-chain tests.
- Proxy tests for HTTP proxy and CONNECT.
- TLS tests for certificate validation, pinning, mTLS.
- HTTP/2 server tests for stream, GOAWAY, pooling, redirect limitations.
- Real browser tests with Playwright for `neutrx/browser`.
- Type tests for public API and generated declarations.
- Package smoke tests for ESM, CJS, subpaths, browser condition.
- Fuzz corpus for URL/header/body security.
- Snapshot tests for redaction.

Quality gates:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run coverage
npm run build
npm run package:validate
```

## Documentation Strategy

Docs needed to win trust:

- `why-neutrx.md`: honest competitive positioning.
- `axios-migration-matrix.md`: exact migration behavior.
- `secure-egress.md`: policy engine and SSRF-safe patterns.
- `adapter-security-contract.md`: how custom adapters must behave.
- `resilience-production.md`: retries, budget, circuit, bulkhead, adaptive concurrency.
- `observability-production.md`: OTEL, Prometheus, events.
- `release-security.md`: provenance, package contents, supply-chain controls.
- `recipes/`: copy-paste use cases.

Docs tone:

- Do not say "better than Axios" broadly.
- Say "better fit for secure Node.js backend service-to-service HTTP".
- Show secure profile first.
- Show `legacy` only in migration/local examples with warnings.

## Release And Supply-Chain Hardening

Current CI is good, but the security product needs visible supply-chain maturity.

Recommended changes:

- Add project `.npmrc`:

```ini
ignore-scripts=true
```

- Prefer npm trusted publishing and provenance.
- Remove long-lived `NPM_TOKEN` once trusted publishing is configured.
- Pin release tooling versions and avoid ad hoc network installs where possible.
- Add `npm pack --dry-run` artifact review in CI output.
- Add SLSA/provenance badge only after it is real.
- Add dependency review, CodeQL, package smoke, and audit status to README.
- Add security advisory workflow instructions.

## Success Metrics

Product:

- 10 complete backend recipes.
- 1-page migration matrix from Axios.
- Public security model with every claim tested.
- Published package provenance.
- Zero runtime dependencies in core.

Engineering:

- 90%+ meaningful coverage on core/security/resilience.
- Fuzz corpus for SSRF/redirect/header injection.
- ESM/CJS/browser exports smoke-tested.
- Node 22/24/25 CI green.
- Package smoke test validates packed tarball, not only source.

Adoption:

- Clear docs for "replace Axios in backend service".
- Clear docs for "do not replace Axios in browser-heavy app unless you accept tradeoffs".
- First-party examples for Express/Fastify/NestJS.
- Repeatable benchmarks.

## Recommended Issue Backlog

1. Add `.npmrc` with `ignore-scripts=true` and document local setup impact.
2. Update `SECURITY.md` with private report contact and GitHub Security Advisory flow.
3. Create `docs/axios-migration-matrix.md`.
4. Create `docs/adapter-security-contract.md`.
5. Add SSRF fuzz fixture tests for URL/IP parser edge cases.
6. Add mixed DNS answer test where any unsafe answer blocks request.
7. Add redirect-chain tests across h1 and h2 behavior.
8. Add per-request `auth` alias with redaction tests.
9. Add URL-encoded form helper or explicit serializer recipe.
10. Add real Playwright browser CI for `neutrx/browser`.
11. Add OTEL semantic convention docs and tests.
12. Add cache revalidation: ETag, Last-Modified, stale-if-error.
13. Define cache adapter interface.
14. Build optional Redis cache plugin package.
15. Define shared retry budget/circuit interface.
16. Add adaptive concurrency controller behind opt-in config.
17. Add mTLS/certificate policy docs and tests.
18. Add HTTP/2 session pool metrics and GOAWAY handling.
19. Add OpenAPI generator design doc.
20. Add reproducible benchmark report.

## Final Recommendation

Neutrx should compete with Axios only where Axios is weakest for backend security:

- secure outbound policy
- SSRF and redirect protection
- redacted typed errors
- fleet-safe resilience
- observability
- trusted release path

Do not dilute the project by chasing every browser/runtime edge. Build the best backend egress client, prove it with tests and docs, and make migration from Axios low-friction.

## Sources Reviewed

Local Neutrx files:

- `package.json`
- `README.md`
- `docs/`
- `src/`
- `tests/`
- `.github/workflows/`
- `examples/`
- `SECURITY.md`
- `THREATMODEL.md`
- `ROADMAP.md`

Axios sources:

- Axios GitHub README: https://github.com/axios/axios
- Axios package metadata: https://raw.githubusercontent.com/axios/axios/v1.x/package.json
- Axios latest GitHub release visible at review time: v1.16.1 on 2026-05-13
