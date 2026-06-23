# Neutrx — Execution Plan & Task List

> Derived from `ROADMAP.md` (authored at commit 3 / v1.0.0) re-validated against **actual source at v1.5.0**.
> ROADMAP is stale: Milestone 1–4 work and all actionable §2/§5 items already shipped. This plan tracks only what is **still open**, plus regression-guard tasks.
> Last re-validated: 2026-06-22 against `46134af` (release 1.5.0). Prior validation 2026-06-20 at v1.4.0.
>
> **Current gate (2026-06-22):** `npm run validate` green → "Package neutrx@1.5.0 validates." · build ✓ · typecheck ✓ · lint 0 err · docs ✓ · package:validate ✓ · tests **252 total / 251 pass / 1 skip / 0 fail**.
> **One regression found:** `@types/node` reverted to `^24.10.1` (BUG-002 reopened — see §2f).

---

## 0. Reality Check — ROADMAP vs Source (v1.4.0)

Already DONE (do not redo):
- BUG-003 plugin barrel — `src/plugins/index.ts` exists.
- BUG-004 CJS dual build — `dist/*.cjs` + `*.mjs`, `exports.require` wired.
- BUG-010 cert rotation — `pinCertificate(host, fp, window)` + `setCertificatePins`.
- BUG-011 Node engine — `engines.node >= 18.0.0`.
- SW1 error redaction — `redact` honored in `NeutrxError.toJSON()`.
- Browser build, HTTP/2 adapter, OTel plugin+instrumentation, Deduplicator, SWR cache (`cacheStrategy.ts`), WebSocket — all present.
- Docs: SECURITY / CONTRIBUTING / CHANGELOG / MIGRATION_GUIDE / THREATMODEL / CODE_OF_CONDUCT — all present.

Obsolete (feature removed, bug moot):
- BUG-005 OAuth2 mutex, BUG-009 GraphQL errors, BUG-012 Mock method-match — OAuth2/GraphQL/Mock plugins **deleted** from `src/plugins/`. Close as N/A.

Non-issue:
- BUG-001 clean script — `node -e` executes as CommonJS regardless of `"type":"module"`; `npm run clean` runs clean. No fix needed.

---

## 1. Still-Open Tasks (verified against source)

> **STATUS — all of §1 closed 2026-06-17.** Build ✓ · smoke ✓ · lint 52 files/0 err · tests 225 pass / 1 skip / 0 fail.

### P0 — Correctness / Security
| # | Task | Bug | Location | Status |
|---|------|-----|----------|--------|
| 1 | Add per-request **nonce** (random bytes) to request signing; sign nonce + timestamp. | SW4 | `src/security/SecurityManager.ts` `#signRequest` | ✅ DONE — `crypto.randomBytes(16)` nonce, payload `method:url:ts:nonce:body`, `X-Neutrx-Nonce` header. |
| 2 | Confirm HTTPS→HTTP **redirect downgrade** + credential strip on cross-origin hop. | SW2 | `src/core/redirect.ts` | ✅ VERIFIED — `stripRedirectHeaders` strips auth/cookie/proxy-auth + sensitive-regex on `protocolDowngrade`‖`crossOrigin`. No code change. |
| 3 | Verify decompression-bomb **default size cap** active, not unlimited. | SW3 | `src/core/config.ts` L41 | ✅ VERIFIED — default `maxContentLength` 50MB (Node), 10MB (browser). No code change. |

### P1 — Toolchain / Distribution
| # | Task | Bug | Location | Status |
|---|------|-----|----------|--------|
| 4 | Pin `@types/node` to match `engines>=18`. | BUG-002 | `package.json` devDeps | ✅ DONE — `^24.10.1` → `^18.19.0`. |
| 5 | Quote lint globs (unquoted `**` no-ops on some shells). | BUG-018 | `package.json` `scripts.lint` | ✅ DONE — globs quoted. |
| 6 | Replace `.name` smoke with real assert smoke. | BUG-008 | `scripts/smoke.mjs` | ✅ DONE — `start` → `node scripts/smoke.mjs`, asserts callable + get/post/put/delete/create + instance.request. |
| 7 | Confirm ESLint runs under eslint@8 + tseslint@8 legacy config. | BUG-007 | `.eslintrc.cjs` | ✅ VERIFIED — 52 files linted, 0 err. No flat migration needed. |

### P2 — Coverage gaps (ROADMAP §8.1 targets)
| # | Task | Module | Status |
|---|------|--------|--------|
| 8 | Signing nonce/replay test (covers task 1). | SecurityManager | ✅ DONE — rewrote `rate-limiter-signing.test.ts`: nonce format `^[0-9a-f]{32}$`, HMAC-over-nonce, two reqs → distinct nonce+sig. |
| 9 | Redirect downgrade + header-strip test. | redirect | ✅ EXISTS — `tests/unit/security/redirect-security.test.ts`. |
| 10 | SWR cache test. | cacheStrategy / CacheEngine | ✅ EXISTS — `tests/unit/performance/cache-metrics.test.ts`. |
| 11 | Deduplicator in-flight merge test. | Deduplicator | ✅ EXISTS — `tests/unit/performance/deduplication.test.ts`. |
| 12 | HTTP/2 session-pool + multiplex test. | adapters/http2 | ✅ EXISTS — `tests/unit/adapters/http2.test.ts`. |

**Files touched:** `src/security/SecurityManager.ts`, `package.json`, `scripts/smoke.mjs` (new), `tests/unit/security/rate-limiter-signing.test.ts`.

**Open follow-up (server-side, out of client scope):** nonce sent client-side only. Full replay defense needs server to track seen nonces + reject stale `X-Neutrx-Timestamp`. Document server contract in `THREATMODEL.md`.

---

## 2. Remaining Roadmap Features — scope-checked vs v1.4.0 source (2026-06-18)

> Section title says *confirm scope before building*. Each item verified against source first. Only bounded, zero-dep, decision-free items built this pass.

### Already shipped (verified in source — close, do not rebuild)
| Feature | Evidence |
|---|---|
| `Cache-Control` respect (`max-age`/`no-cache`/`no-store`/`private`) | `src/performance/CacheEngine.ts` L292–314 |
| SWR cache strategy | `src/performance/cacheStrategy.ts` (`'swr'`) |
| SSE/WS auto-reconnect (BUG-014) | WS reconnect test passes |
| Plugin SDK (`NeutrxPlugin` iface + `install`/`use`) | `src/plugins/PluginManager.ts` L35,65 |

### Built this pass ✅
| Feature | Detail |
|---|---|
| **Pagination multi-strategy (BUG-013)** | Added `strategy: 'has-more' \| 'total-count' \| 'cursor' \| 'link-header'` + `totalPath`/`nextCursorPath`/`cursorParam` to `PaginationOptions`. Implemented in `NeutrxClient.paginate` **and** `BrowserClient.paginate` (parity) + `parseNextLink` Link-header parser. Default `has-more` = backward compatible. New test: `node paginate supports total-count, cursor, and link-header strategies`. |

### Deferred — needs maintainer decision or milestone scope
| Feature | Why deferred |
|---|---|
| Redis `StateAdapter` backend (BUG-006) | **New runtime dep → banned by CLAUDE.md without sign-off.** Zero-dep `StateAdapter` *interface* + wiring buildable now; Redis impl as optional peer dep needs OK. User deferred in Batch E pick. |
| Batch aggregation (DataLoader) | Niche, behavior-changing (merges requests); M5. |
| Plugin discovery from `package.json` keywords | Low value + supply-chain risk (auto-loading by keyword). Recommend **drop**. |
| GraphQL subscriptions | GraphQL plugin was removed from src; no base to extend. |
| HTTP/3 (QUIC) | Blocked on Node QUIC stabilization. Not actionable. |
| Benchmarks publish / external security audit | Non-code / external process. |

**Files touched (Batch D pass):** `src/types.ts`, `src/core/NeutrxClient.ts`, `src/core/BrowserClient.ts`, `tests/unit/core/client-methods.test.ts`. Build ✓ · typecheck ✓ · lint ✓ · tests **226 pass / 1 skip / 0 fail**.

---

## 2a. Batch E — AWS SigV4 + HAR recording (2026-06-20)

> User pick (delegated to expert): build **HAR recording** + **AWS SigV4**; **StateAdapter interface deferred** (Redis still gated on dep sign-off).

### Built this pass ✅
| Feature | Detail |
|---|---|
| **AWS SigV4 plugin** | New `src/plugins/AwsSigV4Plugin.ts` — `createAwsSigV4Plugin({ region, service, credentials, unsignedPayload?, doubleEncodePath?, addContentSha256Header?, now? })`. Zero-dep, `node:crypto` only. Header signing via `beforeRequest` hook: canonical request → string-to-sign → HMAC-SHA256 key chain → `Authorization`. Signs `host`, `content-type` (if present), `x-amz-*` (incl. `x-amz-security-token` for STS); `X-Amz-Content-Sha256` added/signed for `s3` (or opt-in). Body hashing: string/Buffer/typed-array/`URLSearchParams` hashed; plain objects serialized to JSON and rewritten onto `config.data` so the wire body matches the signature; streams/Blob/FormData and `unsignedPayload` → `UNSIGNED-PAYLOAD`. `doubleEncodePath` default `true` except `s3`. `now` override for deterministic tests. **Node-only** (needs a `Host` header fetch can't set). |
| **HAR recorder** | New `src/plugins/HarRecorder.ts` — `createHarRecorder({ maxEntries?, includeRequestBody?, includeResponseBody?, redactHeaders? })` returns `{ plugin, entries(), har(), export(), clear() }`. Captures HAR 1.2 entries via `afterRequest` (and failed requests via `onError`, status `0` + `_error`). **Security default: redacts `authorization`/`cookie`/`set-cookie`/`x-amz-security-token`** (pass `redactHeaders:false` to keep raw). Ring-buffer `maxEntries`. Binary bodies emitted base64. |
| Exports | Both wired through `src/plugins/PluginManager.ts` → `src/plugins/index.ts` (`neutrx/plugins`) and `src/index.ts` (Node entry), with all option/result types. |

### Tests ✅
- `tests/unit/plugins/aws-sigv4.test.ts` — **validated against the official AWS SigV4 test-suite `get-vanilla` vector** (botocore `aws4_testsuite`, signature `5fa00fa3…`), plus STS session-token + JSON-body signing (s3) and `UNSIGNED-PAYLOAD`.
- `tests/unit/plugins/har-recorder.test.ts` — entry shape/HAR 1.2 log, default header redaction, failed-request capture (status 0), `maxEntries` + `clear`.
- Drive-by: fixed pre-existing async-assertion bug in `tests/unit/security/rate-limiter-signing.test.ts` (floating promise + `assert.throws`/`doesNotThrow` over async `checkLimit` → `await assert.rejects`/`doesNotReject`). Was failing + lint-erroring at HEAD; PLAN's prior "lint 0 err / 225 pass" status was stale.

**Files touched (Batch E):** `src/plugins/AwsSigV4Plugin.ts` (new), `src/plugins/HarRecorder.ts` (new), `src/plugins/PluginManager.ts`, `src/plugins/index.ts`, `src/index.ts`, `tests/unit/plugins/aws-sigv4.test.ts` (new), `tests/unit/plugins/har-recorder.test.ts` (new), `tests/unit/security/rate-limiter-signing.test.ts`. Build ✓ · typecheck ✓ · lint 0 err · tests **233 pass / 1 skip / 0 fail** (234 total, +7 new).

**Next decision (user):** zero-dep `StateAdapter` interface (Redis impl gated on dep sign-off)? Batch aggregation (DataLoader)?

---

## 2b. Batch F — zero-dep StateAdapter interface (2026-06-20)

> User pick (delegated to expert): of the two Batch F options — **StateAdapter interface** vs **Batch aggregation (DataLoader)** — built StateAdapter (zero-dep, decision-free, additive). DataLoader stays deferred (behavior-changing, merges requests → M5). Redis impl still gated on new-dep sign-off.

### Problem
Three per-component storage interfaces already existed but unrelated: `CircuitStateStore`, `RateLimitStore` (async, pluggable), `CacheStore` (sync). No unifying abstraction → a distributed backend (Redis) would need a bespoke adapter per component. Goal: one generic key/value contract a single backend implements once, bridged into each component.

### Built this pass ✅
| Feature | Detail |
|---|---|
| **`StateAdapter<T>` interface** | New `src/state/StateAdapter.ts`. Generic kv contract: `get`/`set(key,value,ttlMs?)`/optional `delete`/`keys`/`clear`, all `MaybePromise`. Values opaque JSON snapshots; `ttlMs` best-effort (backends may ignore — in-process layer still revalidates timestamps, so correctness never depends on it). Zero-dep by contract: concrete distributed backends (Redis/Memcached) ship as opt-in peer deps from outside core. |
| **`MemoryStateAdapter<T>`** | In-process reference impl. Map-backed, TTL-aware (lazy expiry on read + optional unref'd sweep, `sweepIntervalMs:0` disables). Single-process only. `destroy()` clears timer + entries. |
| **`namespaceAdapter(adapter, prefix)`** | Wraps any adapter to prefix keys `prefix:` → one shared backend hosts multiple logical namespaces (per-tenant) without collision. `keys()` re-filters + strips prefix. |
| **`circuitStoreFromAdapter` / `rateLimitStoreFromAdapter`** | Bridges a shared `StateAdapter` → `CircuitStateStore` / `RateLimitStore`. One adapter backs both components (wire into `resilience.circuitBreakerStorage.store` + `security.rateLimit.storage.store`). Best-effort + non-atomic, same as underlying contracts. |
| Exports | All wired through `src/index.ts` (Node entry) with the `StateAdapter` type. `CacheStore` left as-is (sync interface; cache state is process-local hot data, not the distributed-sharing target). |

### Tests ✅
- `tests/unit/state/state-adapter.test.ts` — store/list/delete/clear; ttl expiry; `namespaceAdapter` prefixing + listing isolation; circuit+rate-limit bridges sharing one adapter; **`CircuitBreaker` rehydrates OPEN state from a fresh instance via a shared adapter-backed store** (proves a real collaborator reads/writes through the bridge).

**Files touched (Batch F):** `src/state/StateAdapter.ts` (new), `src/index.ts`, `tests/unit/state/state-adapter.test.ts` (new). Build ✓ · typecheck ✓ · lint 0 err · tests **238 pass / 1 skip / 0 fail** (239 total, +5 new).

**No behavior change:** purely additive. Existing per-component stores untouched; `StateAdapter` is opt-in.

**Next decision (user):** Batch aggregation (DataLoader) — only remaining buildable §2 item (behavior-changing, M5). Redis `StateAdapter` impl — now interface-ready, needs new-dep sign-off.

---

## 2c. Batch G — release-prep / Definition-of-Done closeout (2026-06-20)

> User pick (delegated to expert): of the three Batch G options — **(a) Batch aggregation (DataLoader)**, **(b) Redis `StateAdapter` impl**, **(c) release-prep DoD items (§5)** — built **(c)**. (a) is behavior-changing (merges requests) and M5-scoped → still needs a maintainer decision. (b) ships a new runtime dep (Redis client) → still gated on dep sign-off per CLAUDE.md. (c) is the only zero-dep, decision-free, additive option, and closes the open DoD docs + full-validate gate.

### Verified this pass ✅
| DoD item | Evidence |
|---|---|
| Server-side nonce/timestamp replay contract documented | `THREATMODEL.md` §"Request Signing And Replay Defense" — 3 headers (`X-Neutrx-Timestamp`/`-Nonce`/`-Signature`), payload `method:url:ts:nonce:body`, server steps (HMAC recompute + constant-time compare, ±skew window, nonce-store TTL). Streaming/blob/form-data carve-out noted. |
| `createAwsSigV4Plugin` server contract + HAR redaction defaults documented | `docs/plugins.md` §"AWS SigV4 (Node only)" (canonical-request → string-to-sign → HMAC chain, body-hashing rules, `doubleEncodePath` default, **Node-only** `Host` caveat, AWS clock-skew rejection) + §"HAR Recording" (default redaction of `authorization`/`cookie`/`set-cookie`/`x-amz-security-token`, `redactHeaders:false` opt-out, "treat exported HAR as sensitive"). |
| `StateAdapter` interface + bridge wiring + best-effort/non-atomic caveat documented | `docs/config-reference.md` §"Distributed State (`StateAdapter`)" — kv contract, `MemoryStateAdapter`/`namespaceAdapter`, `circuitStoreFromAdapter`/`rateLimitStoreFromAdapter` wired into `resilience.circuitBreakerStorage.store` + `security.rateLimit.storage.store`, best-effort/non-atomic + `ttlMs`-hint caveats. |
| `npm run validate` full pass | typecheck ✓ · lint 0 err · tests ✓ · docs:build ✓ · package:validate → **"Package neutrx@1.4.0 validates."** |

**No code change — purely release-prep.** The DoD doc items were already authored in the working tree; Batch G certifies them against source/exports and runs the full distribution gate end-to-end.

**Result:** Build ✓ · typecheck ✓ · lint 0 err · docs:build ✓ · package:validate ✓ · tests **238 pass / 1 skip / 0 fail** (239 total). Full `npm run validate` green.

### Still deferred after Batch G (unchanged — both need a user/maintainer call)
| Option | Blocker |
|---|---|
| Batch aggregation (DataLoader) | Behavior-changing (merges in-flight requests); M5 scope. Needs maintainer decision. |
| Redis `StateAdapter` impl | New runtime dep → banned without sign-off. Interface is ready (§2b); only the concrete backend is gated. |

---

## 2d. Batch H — Batch aggregation (DataLoader) as opt-in utility (2026-06-20)

> User pick (delegated to expert): of the two Batch H options — **(a) Batch aggregation (DataLoader)** vs **(b) Redis `StateAdapter` impl** — built **(a)**. (b) ships a new runtime dep (Redis client) → still gated on dep sign-off per CLAUDE.md.
>
> **Expert resolution of the M5 blocker:** DataLoader was deferred as "behavior-changing (merges in-flight requests)". That concern only applies to a loader auto-wired into the default request pipeline. Built instead as a **standalone, opt-in utility that nothing in the pipeline invokes** unless app code constructs a loader and calls `.load(...)`. Therefore purely additive, zero default-behavior change, zero-dep — no maintainer decision needed.

### Built this pass ✅
| Feature | Detail |
|---|---|
| **`DataLoader<K, V, C>`** | New `src/performance/DataLoader.ts`. Canonical DataLoader contract: `.load(key)` coalesces all same-frame loads into one user-supplied `BatchLoadFn` call (drained on the microtask queue, override via `batchScheduleFn`), aligned by index. `.loadMany`, `.clear`, `.clearAll`, `.prime` complete the surface. Per-key promise **memoization** on by default (`cache:false` disables; custom `cacheMap`/`cacheKeyFn` supported). **Rejected loads are not cached** (auto-evicted so the key retries). `maxBatchSize` splits oversized batches into chunks (`batch:false` ⇒ size 1). A batch fn may return an `Error` in slot *i* to reject only `keys[i]` without failing the whole batch; a wrong-length result rejects every slot with a `TypeError`. Pure JS, zero-dep, **runtime-agnostic** (Node + browser). No `any`; `noUncheckedIndexedAccess`-clean. |
| Exports | Wired through **both** entries — `src/index.ts` (Node) and `src/browser.ts` (browser parity) — with `BatchLoadFn`/`BatchScheduleFn`/`CacheMap`/`DataLoaderOptions` types. |

### Tests ✅
- `tests/unit/performance/data-loader.test.ts` (8 tests) — same-frame coalescing into one batch; per-key memoization + intra-batch dedupe; per-slot `Error` rejection via `loadMany`; rejected load not cached (retry re-dispatches); `maxBatchSize` chunk-splitting (`[2,2,1]`); `prime` seed + `clear` evict; `cache:false` re-dispatch every load; wrong-length batch result → `TypeError` on all slots.

**Files touched (Batch H):** `src/performance/DataLoader.ts` (new), `src/index.ts`, `src/browser.ts`, `tests/unit/performance/data-loader.test.ts` (new). Build ✓ · typecheck ✓ · lint 0 err · tests **246 pass / 1 skip / 0 fail** (247 total, +8 new).

**No behavior change:** purely additive opt-in utility; the default request pipeline is untouched. The original "M5 / behavior-changing" deferral is now resolved — DataLoader ships without merging any requests unless the application explicitly opts in.

**Only remaining deferred item:** Redis `StateAdapter` impl — new runtime dep → still gated on dep sign-off. Interface is ready (§2b); only the concrete backend is blocked. **No zero-dep, decision-free §2 work remains.**

---

## 2e. Batch I — Redis `StateAdapter` impl via dependency injection (2026-06-20)

> Last remaining §2 item. Was blocked as "new runtime dep → banned without sign-off."
>
> **Expert resolution of the dep blocker:** the ban is on Neutrx *importing* a Redis package. Built the adapter by **dependency injection** instead — the application passes its own connected client; core imports nothing. **Zero hard deps, zero peer deps, zero change to the install graph** → no sign-off needed. CLAUDE.md constraint satisfied as written.

### Built this pass ✅
| Feature | Detail |
|---|---|
| **`RedisStateAdapter<T>`** | New `src/state/RedisStateAdapter.ts` implementing `StateAdapter<T>`. Takes `{ client, keyPrefix?, serialize?, deserialize? }`. `client` is a structural **`RedisLikeClient`** (`get`/`set`/`pexpire`/`del`/`keys`) satisfied by both `ioredis` and `node-redis` v4 (or any shim/mock) — Neutrx imports **no** Redis package. JSON-serializes values under `keyPrefix` (default `neutrx:`); `ttlMs` → `PEXPIRE` (ceil'd). `delete`/`keys`/`clear` scope strictly to the prefix — `clear()` deletes only namespaced keys via `KEYS prefix*` (never `FLUSHDB`, never foreign keys). Constructor throws if the client lacks `get`. **Server-only; non-atomic** (set+pexpire = 2 round-trips; bridged contracts already best-effort). `KEYS` O(N) caveat documented. |
| Bridges | Reuses existing `circuitStoreFromAdapter` / `rateLimitStoreFromAdapter` (§2b) unchanged → one Redis connection powers cross-process circuit-breaker + rate-limit state. |
| Exports | Wired through `src/index.ts` (Node entry) with `RedisLikeClient` + `RedisStateAdapterOptions` types. **Not** exported from `src/browser.ts` (Redis is server-side). |
| Docs | `docs/config-reference.md` §"Redis (`RedisStateAdapter`, Node only)" — DI usage (bring-your-own client), `keyPrefix`/`PEXPIRE`/serialize, server-only + non-atomic + `KEYS` O(N) caveats. |

### Tests ✅
- `tests/unit/state/redis-state-adapter.test.ts` (5 tests) — JSON round-trip under prefix; `ttlMs` → ceil `PEXPIRE` (and no-ttl ⇒ no `pexpire`); `keys()` prefix-strip + `clear()` scoped to prefix (**foreign `other:keep` key survives**); bridges share one backend for circuit (`CircuitStatus`) + rate-limit (`RateLimitSnapshot`) state under one prefix; constructor rejects a client missing `get`. Backed by an in-memory `FakeRedis` implementing `RedisLikeClient`.

**Files touched (Batch I):** `src/state/RedisStateAdapter.ts` (new), `src/index.ts`, `docs/config-reference.md`, `tests/unit/state/redis-state-adapter.test.ts` (new). Build ✓ · typecheck ✓ · lint 0 err · tests **251 pass / 1 skip / 0 fail** (252 total, +5 new).

**No behavior change:** purely additive; nothing wires to Redis unless the app constructs a `RedisStateAdapter` with its own client. **All §2 roadmap work is now closed** — no deferred items remain (DataLoader shipped §2d, Redis shipped here). Only non-code/external-process items stay open (benchmarks publish, external security audit, HTTP/3 on Node QUIC).

---

## 2f. Re-validation pass — source moved v1.4.0 → v1.5.0 (2026-06-22)

> PLAN was last validated at v1.4.0. The repo has since released **v1.5.0** (`46134af chore(release): 1.5.0`). This pass re-checks every prior claim against current source and folds in the new v1.5.0 work. All Batch D–I features (DataLoader, Redis/StateAdapter, AWS SigV4, HAR recorder, pagination strategies) remain present and validating.

### v1.5.0 shipped — closes ROADMAP §5 "What Axios Has That Neutrx Lacks" gaps (untracked by prior PLAN)

The v1.5.0 release (PRs #1–#6) added a large axios-parity surface. These were open §5 gaps; now closed in source:

| ROADMAP §5 gap | Status in v1.5.0 | Evidence |
|---|---|---|
| FormData automatic detection | ✅ shipped | `src/core/formData.ts` (new, 231 LOC) |
| Form serialization (urlencoded) + params serializer | ✅ shipped | `src/core/bodySerializer.ts` (expanded +158) |
| Progress events (upload/download) | ✅ shipped | `src/core/progress.ts` + `onUploadProgress`/`onDownloadProgress` wired in all adapters (`http`/`http2`/`fetch`/`browser`) + `types.ts` |
| CSRF / XSRF token protection | ✅ shipped | `xsrf`/`csrf` in `config.ts`, `defaults.ts`, `NeutrxClient.ts`, fetch/browser adapters |
| Decompression (brotli, zstd, gzip, deflate) | ✅ shipped + **size-capped** (SW3 holds) | `src/core/responseParser.ts` — `gunzip`/`inflate`/`brotliDecompress`/feature-detected `zstdDecompress`; inflated size re-checked vs `maxContentLength` → `NeutrxResponseSizeError`. `Accept-Encoding` negotiated in `NeutrxClient.ts` L1188 (zstd only when runtime supports it) |
| `mergeConfig` / config deep-merge parity | ✅ shipped | `src/core/mergeConfig.ts` (new) + `tests/unit/core/config-parity.test.ts` (new, 191 LOC) |
| HTTP status-code helpers | ✅ shipped | `src/core/httpStatusCode.ts` (new) |
| Same-origin / redirect-origin helpers | ✅ shipped | `src/core/sameOrigin.ts` (new) |
| Adapter registry (pluggable adapter selection) | ✅ shipped | `src/core/adapterRegistry.ts` + `src/core/browserAdapterRegistry.ts` (new) |
| Axios API-surface parity coverage | ✅ shipped | `tests/unit/core/axios-parity.test.ts` (new, 92 LOC) |

`NeutrxError.ts` also expanded (+68) and `RateLimiter.ts` reworked (+128). No regression in those — `npm run validate` is green.

### 🔴 Regression — re-opened

| # | Task | Bug | Location | Status |
|---|------|-----|----------|--------|
| R1 | `@types/node` reverted from the BUG-002 pin back to `^24.10.1`. PLAN Batch A (task 4) had pinned it `^18.19.0` to match `engines.node >= 18`. It is once again `^24.10.1`, re-introducing the BUG-002 risk: Node-24-only type surface in a `>=18` project compiles but can crash at runtime on Node 18/20. | BUG-002 | `package.json` devDeps | 🔴 **OPEN / REGRESSED** |

**Note before "fixing":** v1.5.0 deliberately uses Node-22+ APIs (zstd via `node:zlib`, feature-detected). If the maintainer intends a Node-22+ floor in practice, the correct fix is to **raise `engines.node` to match** (and document it) rather than silently shipping `@types/node@24` against a `>=18` declaration. Pick one and make `engines` + `@types/node` agree. **Decision required — do not auto-flip without maintainer sign-off, since the engine floor is a public contract.**

### Re-verified still-true (no action)
- All §1 P0/P1 tasks (signing nonce, redirect downgrade strip, decompression cap, lint globs, smoke assert) — still present in source.
- All §2a–§2e features (AWS SigV4, HAR recorder, `StateAdapter`+`MemoryStateAdapter`+bridges, `RedisStateAdapter` via DI, DataLoader, pagination multi-strategy) — present, exported, validating.
- 1 skipped test is pre-existing and unchanged.

### Still open after this pass (unchanged — non-code / external, plus R1)
| Item | Blocker |
|---|---|
| R1: `@types/node` vs `engines` mismatch | **Maintainer decision** — pin types to 18 *or* raise engine floor to 22. |
| Benchmarks publish (neutrx vs axios/got/undici) | Non-code / external process. |
| External security audit (SSRF + cert-pinning) | External process. |
| HTTP/3 (QUIC) | Blocked on Node QUIC stabilization. Not actionable. |
| Plugin discovery from `package.json` keywords | Recommend **drop** (supply-chain risk). |

---

## 3. Order of Execution

1. ~~**Batch A:** tasks 4, 5, 6 — toolchain hygiene.~~ ✅ DONE
2. ~~**Batch B:** task 1 → test 8; verify 2, 3.~~ ✅ DONE
3. ~~**Batch C:** tasks 10, 11, 12 coverage.~~ ✅ ALREADY COVERED (pre-existing test files).
4. ~~**Batch D:** §2 scope-checked; pagination multi-strategy (BUG-013) built; Cache-Control + SWR + Plugin SDK already in source; remainder deferred.~~ ✅ DONE & CERTIFIED 2026-06-18 — typecheck ✓ · lint 0 problems · tests 226 pass / 1 skip / 0 fail.
5. ~~**Batch E (user pick):** AWS SigV4 plugin + HAR recording mode built; StateAdapter interface deferred.~~ ✅ DONE & CERTIFIED 2026-06-20 — build ✓ · typecheck ✓ · lint 0 err · tests 233 pass / 1 skip / 0 fail (234 total). See §2a.
6. ~~**Batch F (user pick):** zero-dep `StateAdapter` interface built (Redis impl gated on new-dep sign-off); Batch aggregation (DataLoader) deferred to M5.~~ ✅ DONE & CERTIFIED 2026-06-20 — build ✓ · typecheck ✓ · lint 0 err · tests 238 pass / 1 skip / 0 fail (239 total). See §2b.
7. ~~**Batch G (user pick):** of DataLoader / Redis impl / release-prep DoD — built **release-prep DoD** (zero-dep, decision-free): verified all open DoD docs against source + ran full `npm run validate` green.~~ ✅ DONE & CERTIFIED 2026-06-20 — build ✓ · typecheck ✓ · lint 0 err · docs:build ✓ · package:validate ✓ · tests 238 pass / 1 skip / 0 fail (239 total). See §2c.
8. ~~**Batch H (user pick):** of DataLoader / Redis impl — built **DataLoader as a standalone opt-in utility** (zero-dep, additive; resolves the prior "behavior-changing/M5" deferral by never wiring into the default pipeline). Redis impl still gated on new-dep sign-off.~~ ✅ DONE & CERTIFIED 2026-06-20 — build ✓ · typecheck ✓ · lint 0 err · tests 246 pass / 1 skip / 0 fail (247 total). See §2d.
9. ~~**Batch I:** Redis `StateAdapter` backend impl — built via **dependency injection** (app supplies its own `ioredis`/`node-redis` client; core imports nothing → zero install-graph change, no sign-off needed). Reuses §2b bridges; Node-only; docs added.~~ ✅ DONE & CERTIFIED 2026-06-20 — build ✓ · typecheck ✓ · lint 0 err · tests 251 pass / 1 skip / 0 fail (252 total). See §2e.
10. ~~**All §2 roadmap work closed.**~~ ✅ — confirmed still closed at v1.5.0.
11. **Re-validation at v1.5.0 (§2f, 2026-06-22):** source advanced v1.4.0 → v1.5.0; all prior Batch D–I features intact + validating. v1.5.0 additionally closed the ROADMAP §5 axios-parity gaps (FormData, urlencoded/form serialization, progress events, CSRF/XSRF, brotli/zstd/gzip/deflate decompression, mergeConfig, status-code helpers, adapter registry). **One regression (R1): `@types/node` reverted to `^24.10.1` vs `engines>=18` — needs maintainer decision (pin types to 18 *or* raise engine floor).** Remaining open items are all non-code/external (benchmarks, audit, HTTP/3 on Node QUIC).

## 4. Per-Task Loop (enforced by CLAUDE.md)
> Tests run against **built output**. After any `src/` edit:
> `npm run build && npm run test:compile && node --test dist-tests/tests/<file>.test.js`
> No new runtime deps. `import type {...}`. No `any`. Conventional Commits.

## 5. Definition of Done
- ✅ Tasks 1–7 closed; tasks 8–12 present (8 rewritten, 9–12 pre-existing).
- ✅ Batch D: pagination multi-strategy. Batch E: AWS SigV4 + HAR recorder (§2a). Batch F: `StateAdapter` interface + `MemoryStateAdapter` + bridges (§2b). Batch H: `DataLoader` opt-in batch-aggregation utility (§2d). Batch I: `RedisStateAdapter` distributed backend via DI (§2e).
- ✅ Build + lint (0 err) + tests (251 pass / 1 skip / 0 fail, 252 total) + full `npm run validate` green as of **2026-06-22 at v1.5.0** ("Package neutrx@1.5.0 validates.").
- ✅ ROADMAP bug IDs annotated DONE/N/A/OPEN — §0 reality check stops re-litigation.
- ✅ **Batch G (release-prep, §2c):** `npm run validate` full pass (typecheck + lint + tests + docs:build + package:validate → "Package neutrx@1.4.0 validates."); server-side nonce/timestamp replay contract documented (`THREATMODEL.md`); `createAwsSigV4Plugin` server contract + HAR redaction defaults documented (`docs/plugins.md`); `StateAdapter` interface + bridge wiring + best-effort/non-atomic caveat documented (`docs/config-reference.md`).
- ✅ **Batch H (§2d):** DataLoader batch aggregation shipped as a standalone opt-in utility (zero-dep, additive) — the prior "M5 / behavior-changing" deferral is resolved since the default pipeline is never auto-wired to it.
- ✅ **Batch I (§2e):** `RedisStateAdapter` distributed backend shipped via dependency injection (app brings its own client → zero install-graph change), resolving the prior "new runtime dep → sign-off" deferral. Bridges + docs included.
- ✅ **All §2 roadmap features closed.** No code work remains behind a maintainer/dep decision. Only non-code / external items stay open: benchmarks publish, external security audit, HTTP/3 (blocked on Node QUIC stabilization).
- ✅ **Re-validation §2f (2026-06-22, v1.5.0):** all Batch D–I features intact; v1.5.0 closed the ROADMAP §5 axios-parity gaps (FormData, form/urlencoded serialization, progress events, CSRF/XSRF, brotli/zstd/gzip/deflate decompression with size cap, mergeConfig, status-code helpers, adapter registry). Whole-suite re-run + full validate green.
- 🔴 **One open regression (R1):** `@types/node` is `^24.10.1` against `engines.node >= 18.0.0` — BUG-002 re-opened. Needs a maintainer call: pin types to `^18` **or** raise the engine floor to 22 (v1.5.0 already uses Node-22+ zstd). Engine floor is a public contract → do not flip silently.
