# Neutrx vs Axios — Gap Analysis & Roadmap to Beat Axios

> Code-based competitive analysis. Sources: neutrx `src/**` (read directly) + axios `v1.x` `lib/**`, `index.d.ts`, `README.md`.
> Date: 2026-06-17

---

## 1. Executive Summary

Neutrx already **decisively beats axios** on security, resilience, and performance. These are native, security-bearing, first-class features in neutrx; in axios they are absent and require 6+ third-party plugins that fight each other in interceptor ordering.

The **real gaps are ergonomics, ecosystem parity, and DX polish** — exactly where axios wins adoption. To beat axios in practice (not just on a feature table), neutrx must:

1. Close axios drop-in parity holes (missing helper exports, config fields, zstd).
2. Lean hard into the "0 deps vs 6 deps" resilience story.
3. Push 3 frontiers axios architecturally cannot follow.

**Bottom line:** neutrx wins the feature war; it must now win the migration war and the DX war.

---

## 2. Where Neutrx Already Wins (axios has none of these)

Confirmed present in neutrx code, confirmed absent in axios code/docs:

| Capability | Neutrx | Axios |
|---|---|---|
| SSRF protection (private/metadata/link-local IP block, IPvX variants) | ✅ `SecurityManager`, `security.enableSSRFProtection` | ❌ |
| DNS pinning + re-resolve-on-redirect validation | ✅ `core/dns.ts`, `createPinnedLookup` | ❌ |
| Certificate pinning (SHA-256 + validity windows) | ✅ `tls.certificatePins`, `NeutrxCertPinError` | ❌ |
| Security profiles (`strict`/`standard`/`legacy`) | ✅ `security/profiles.ts` | ❌ |
| Egress policy presets (public-api/internal/webhook/legacy) | ✅ `egressPolicy` | ❌ |
| Circuit breaker (CLOSED/OPEN/HALF_OPEN, distributed store) | ✅ `resilience/CircuitBreaker.ts` | ❌ (needs `opossum`) |
| Bulkhead + adaptive concurrency | ✅ `resilience/Bulkhead.ts` | ❌ |
| Retry engine (4 strategies, budget, idempotency-aware) | ✅ `resilience/RetryEngine.ts` | ❌ (needs `axios-retry`) |
| Cache (max-age / SWR / network-first + revalidation) | ✅ `performance/CacheEngine.ts` | ❌ (needs `axios-cache-interceptor`) |
| Request deduplication (in-flight coalescing) | ✅ `performance/Deduplicator.ts` | ❌ |
| Rate limiting (token-bucket/sliding/fixed, per-domain) | ✅ `security/RateLimiter.ts` | ❌ (needs `axios-rate-limit`) |
| Native OpenTelemetry + Prometheus metrics | ✅ `monitoring/**` | ❌ |
| Plugin system (`beforeRequest`/`afterRequest`/`onError` + mock short-circuit) | ✅ `plugins/PluginManager.ts` | ❌ (interceptors only) |
| First-class HTTP/2 (session pooling, multiplexing) | ✅ `adapters/http2.ts` | ⚠️ experimental, no redirect support |
| WebSocket + SSE native | ✅ `core/websocket.ts`, `sse()` | ❌ |
| Hedged requests, pagination generator, concurrent/sequential/race | ✅ | ❌ (only `Promise.all`) |
| Prototype-pollution protection, header redaction by default | ✅ | ❌ (manual `redact` only) |
| Default size limits (safe) | ✅ profile-driven | ❌ defaults `-1` unlimited |

**Moat is wide. Do not weaken any of it** (per CLAUDE.md non-negotiables).

---

## 3. The Gaps (code-verified)

### GAP CLASS 1 — Missing axios parity helpers (P0, migration blockers) — ✅ DONE

Axios ships standalone utilities. Neutrx now **exports all of them** from both the Node entry (`src/index.ts`) and the browser entry (`src/browser.ts`). Drop-in `axios → neutrx` no longer hits `X is not a function`.

| Axios export | Neutrx status | Implementation |
|---|---|---|
| `toFormData(obj, fd?, opts?)` | ✅ exported | `core/formData.ts` (axios 3-arg signature; appends into a supplied FormData). Shared worker `buildFormData` also feeds `core/bodySerializer.ts` |
| `formToJSON` / `formDataToJSON` | ✅ exported | `core/formData.ts` — faithful axios bracket/index path rebuild; drops prototype-pollution keys (`__proto__`/`constructor`/`prototype`) |
| `HttpStatusCode` enum (100–511) | ✅ exported | `core/httpStatusCode.ts` — numeric enum with name↔code reverse mapping |
| `getAdapter(name)` | ✅ exported | `core/adapterRegistry.ts` (Node: `http`/`https`/`http2`/`fetch`/`xhr`, wired with a default `SecurityManager`) + `core/browserAdapterRegistry.ts` (fetch only); accepts name, custom fn, or array |
| `mergeConfig(a, b)` | ✅ exported | `core/mergeConfig.ts` — public axios-style merge (deep-merges `security`/`resilience`/`performance`/`transitional`/`tls`/`http2Options`/`egressPolicy`/`instrumentation`), no defaults injection |
| `isURLSameOrigin` | ✅ exported | `core/sameOrigin.ts` — `isURLSameOrigin(requestURL, baseURL?)`, browser-location-aware for XSRF parity |
| `axios.all` / `spread` | ❌ (deprecated in axios) | Skipped — `concurrent()` is superior |

**Why it matters:** drop-in migration. A codemod `axios → neutrx` must not hit missing functions. Each missing export = adoption friction.

**Verification:** `tests/unit/core/axios-parity.test.ts` covers every helper (FormData round-trip, prototype-pollution drop, status enum reverse lookup, same-origin matrix, deep merge, adapter resolution). Browser parity preserved (all helpers re-exported from `src/browser.ts`; `formData.ts` carries no `node:*` imports). `npm run typecheck`, `npm run lint`, and the full `npm test` (215 pass) are green.

---

### GAP CLASS 2 — Config field parity holes (P1) — ✅ DONE

Every axios config field is now present on `ClientConfig`/`RequestConfig`/`InternalRequestConfig` (`src/types.ts`) and **wired to its enforcement point** — not just typed. Each flows through the same path: declared in `types.ts`, listed in `core/defaults.ts#SAFE_DEFAULT_KEYS`, threaded by `core/config.ts#buildConfig`, resolved per-request in `NeutrxClient.#buildRC`, and applied at the adapter/security/error layer.

| Axios field | Meaning | Neutrx status | Implementation |
|---|---|---|---|
| `insecureHTTPParser` | accept malformed headers | ✅ opt-in, `legacy`-gated | Passed to Node `http.request` options (`adapters/http.ts:137`); `SecurityManager.validateRequest` throws `INSECURE_PARSER_BLOCKED` unless `profile === 'legacy'` (`security/SecurityManager.ts:119`) |
| `timeoutErrorMessage` | custom timeout message | ✅ explicit field | Overrides default phrasing in `NeutrxConnectTimeoutError`/`NeutrxResponseTimeoutError` (`core/NeutrxError.ts:203,214`); applied by http (`adapters/http.ts:177,188`), http2, and fetch (`adapters/fetch.ts:59`) adapters |
| `family` (4\|6) | IP address family | ✅ simple toggle | Forwarded to `http.request` options (`adapters/http.ts:136`); coexists with `lookup`/DNS pinning |
| `env` (FormData/fetch/Request/Response injection) | runtime polyfill inject | ✅ full object | `env.FormData` honored in body serialization (`core/bodySerializer.ts:40`); `env.fetch`/`env.Request` honored by fetch adapter (`adapters/fetch.ts:17,45`); deep-merged by `mergeConfig` (`core/mergeConfig.ts:13`) |
| `parseReviver` | BigInt-safe JSON parse | ✅ covered by `parseJson` | No alias needed — `parseJson` is strictly more general |
| `redact` | per-request mask list for `toJSON()` | ✅ extends auto-redaction | Extra keys masked across message/url/headers/data/context in `NeutrxError.toJSON` (`core/NeutrxError.ts:58,357,377`); URL placeholder no longer double-encoded (`redactUrl`) |
| `formDataHeaderPolicy` | how FormData manages `Content-Type` | ✅ `auto`/`preserve`/`none` | Drives multipart boundary header logic (`core/bodySerializer.ts:54,79`) |
| `allowedSocketPaths` | socketPath allowlist | ✅ security-positive | `validateSocketPath` rejects off-allowlist + unsafe paths (`core/NeutrxClient.ts:1255`) |
| `sensitiveHeaders` | extra headers stripped cross-origin | ✅ configurable list | Extends the built-in strip set in `stripRedirectHeaders`, cross-origin only (`core/redirect.ts:17,24`); threaded through every redirect hop (`core/NeutrxClient.ts:850`) |

**Why it matters:** drop-in migration. Codemods and hand-ported axios config objects pass through unchanged — no `unknown option` surprises, no silent drops. Security-bearing fields (`insecureHTTPParser`, `allowedSocketPaths`, `sensitiveHeaders`) are parity *and* hardening: opt-in, profile-gated, fail-closed.

**Verification:** `tests/unit/core/config-parity.test.ts` pins observable behavior for every field — `formDataHeaderPolicy` (auto/preserve/none), `env.FormData`/`env.fetch` injection, `sensitiveHeaders` cross-origin strip vs same-origin keep, `timeoutErrorMessage` override, `redact` masking, `allowedSocketPaths` rejection, `insecureHTTPParser` profile gate. Browser parity preserved (`BrowserClient` forwards `timeoutErrorMessage`/`redact`/`formDataHeaderPolicy`/`env`). Fixed a real redaction bug in the process: `redactUrl` percent-encoded the `[REDACTED]` placeholder (`%5BREDACTED%5D`), inconsistent with header/data redaction — now decoded back to the literal token. `npm run typecheck`, `npm run lint`, and the full `npm test` (223 pass, 1 skip) are green.

---

### GAP CLASS 3 — Decompression codec gap (P0)

Axios `v1.x` decompresses gzip / deflate / brotli **+ zstd**. Neutrx = gzip / deflate / brotli only.

**Risk:** axios decodes a `Content-Encoding: zstd` body that neutrx cannot. Add `zlib.createZstdDecompress` (Node 22+) in `adapters/http.ts` decompression path. Advertise `zstd` in `Accept-Encoding`.

---

### GAP CLASS 4 — HTTP/2 redirect following (P0, verify)

Axios HTTP/2 is experimental and explicitly **does not support redirects**. Neutrx HTTP/2 is first-class.

**Open question:** does neutrx `#dispatchWithRedirects` follow redirects over the HTTP/2 adapter, applying SSRF + header-stripping per hop?
- If **yes** → neutrx already beats axios outright here. Document it loudly.
- If **no** → fix it. Instant differentiation: "the only client with secure HTTP/2 redirect following."

Action: add a test (`tests/integration`) — h2 server returns 301 → assert neutrx follows + strips auth on cross-origin.

---

## 4. How to Beat Axios (not just match) — 3 Frontiers

Axios cannot follow here without breaking its zero-opinion design. Neutrx is ~80% built on each.

### Frontier 1 — Type-safe contract layer
Neutrx already has `schema` (Zod/Valibot compatible). Go further:
- `neutrx.define()` — typed endpoint registry → fully-typed client generated from OpenAPI / schema.
- Response `data` inferred from schema, no manual generic param.
- Axios needs `openapi-typescript` + hand-glue. Make it native.

### Frontier 2 — Resilience that's automatic, not assembled
Axios resilience = 6 npm plugins (`axios-retry`, `axios-cache-interceptor`, `opossum`, `axios-rate-limit`, dedup glue, otel glue) that collide in interceptor order. Neutrx = one config object, correct ordering baked into the request pipeline (`NeutrxClient.request()` fixed sequence).
- Ship `profile: 'resilient'` preset — one line turns on retry + circuit + dedup + cache with sane defaults.
- Marketing: **"replace 6 dependencies with 0."**

### Frontier 3 — Runtime / edge breadth
Axios fetch adapter is an afterthought; zero HTTP/3 roadmap.
- Make `neutrx/edge` first-class (Cloudflare Workers / Deno / Bun).
- Experimental HTTP/3 (QUIC) adapter.
- Keep the documented boundary: browser/edge builds cannot claim Node-level network security.

---

## 5. Priority Roadmap

| Priority | Item | Effort | Payoff |
|---|---|---|---|
| ~~**P0**~~ ✅ | ~~Export `toFormData`, `formToJSON`, `HttpStatusCode`, `getAdapter`, `mergeConfig`, `isURLSameOrigin`~~ **DONE** | S | Unblock migration |
| **P0** | Add zstd decompression + Accept-Encoding advertise | S | Codec parity |
| **P0** | Verify + fix HTTP/2 redirect following (+ test) | M | Beat axios outright |
| ~~**P1**~~ ✅ | ~~Config fields: `family`, `timeoutErrorMessage`, `redact`, `insecureHTTPParser`, `sensitiveHeaders`, `formDataHeaderPolicy`, `allowedSocketPaths`~~ **DONE** | S–M | Drop-in parity |
| **P1** | `profile: 'resilient'` one-line preset | S | "0 vs 6 deps" story |
| **P2** | `neutrx.define()` typed endpoint registry | L | Frontier lead |
| **P2** | `neutrx/edge` first-class + HTTP/3 experimental | L | Frontier lead |
| **P2** | Migration codemod `axios → neutrx` | M | Adoption flywheel |

**Constraints (from CLAUDE.md):** no new runtime deps; keep ESM+CJS+dts working; do not weaken SSRF/redirect/redaction/size/timeout/retry/circuit/cache/metrics; every change needs tests + docs; Conventional Commits; check browser parity (`BrowserClient`) for each new feature.

---

## 6. Suggested First PR (P0 batch)

1. ✅ **DONE** — `feat: export toFormData, formToJSON, HttpStatusCode, getAdapter, mergeConfig, isURLSameOrigin` — surfaced via `core/formData.ts`, `core/httpStatusCode.ts`, `core/sameOrigin.ts`, `core/mergeConfig.ts`, `core/adapterRegistry.ts` (+ browser `core/browserAdapterRegistry.ts`), all re-exported from `src/index.ts` and `src/browser.ts`. No new subpaths — helpers live on the main entries. Tests in `tests/unit/core/axios-parity.test.ts`.
2. `feat: add zstd decompression support` — `adapters/http.ts`, advertise in Accept-Encoding, gate on Node version.
3. `test: verify HTTP/2 redirect following with SSRF + header strip` — confirm or fix behavior.

Each: add tests (`tests/unit` + `tests/integration`), update docs, verify `npm run validate`.
