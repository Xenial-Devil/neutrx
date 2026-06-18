# Neutrx — Execution Plan & Task List

> Derived from `ROADMAP.md` (authored at commit 3 / v1.0.0) re-validated against **actual source at v1.4.0**.
> ROADMAP is stale: most Milestone 1–3 work already shipped. This plan tracks only what is **still open**, plus regression-guard tasks.
> Validated: 2026-06-17.

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
| Redis `StateAdapter` backend (BUG-006) | **New runtime dep → banned by CLAUDE.md without sign-off.** Zero-dep `StateAdapter` *interface* + wiring buildable now; Redis impl as optional peer dep needs OK. |
| HAR recording mode | Zero-dep, buildable; M3 scope, ~6h. Offer next. |
| Batch aggregation (DataLoader) | Niche, behavior-changing (merges requests); M5. |
| AWS SigV4 plugin | Zero-dep (crypto); M5 plugin scope, ~6h. Offer next. |
| Plugin discovery from `package.json` keywords | Low value + supply-chain risk (auto-loading by keyword). Recommend **drop**. |
| GraphQL subscriptions | GraphQL plugin was removed from src; no base to extend. |
| HTTP/3 (QUIC) | Blocked on Node QUIC stabilization. Not actionable. |
| Benchmarks publish / external security audit | Non-code / external process. |

**Files touched (this pass):** `src/types.ts`, `src/core/NeutrxClient.ts`, `src/core/BrowserClient.ts`, `tests/unit/core/client-methods.test.ts`. Build ✓ · typecheck ✓ · lint ✓ · tests **226 pass / 1 skip / 0 fail**.

**Next decision (user):** build zero-dep `StateAdapter` interface (Redis impl gated on dep sign-off)? HAR mode? AWS SigV4?

---

## 3. Order of Execution

1. ~~**Batch A:** tasks 4, 5, 6 — toolchain hygiene.~~ ✅ DONE
2. ~~**Batch B:** task 1 → test 8; verify 2, 3.~~ ✅ DONE
3. ~~**Batch C:** tasks 10, 11, 12 coverage.~~ ✅ ALREADY COVERED (pre-existing test files).
4. ~~**Batch D:** §2 scope-checked; pagination multi-strategy (BUG-013) built; Cache-Control + SWR + Plugin SDK already in source; remainder deferred.~~ ✅ DONE & CERTIFIED 2026-06-18 — typecheck ✓ · lint 0 problems · tests 226 pass / 1 skip / 0 fail.
5. **Batch E~ (NEXT — needs user pick):** zero-dep `StateAdapter` interface / HAR mode / AWS SigV4. Redis backend gated on new-dep sign-off.

## 4. Per-Task Loop (enforced by CLAUDE.md)
> Tests run against **built output**. After any `src/` edit:
> `npm run build && npm run test:compile && node --test dist-tests/tests/<file>.test.js`
> No new runtime deps. `import type {...}`. No `any`. Conventional Commits.

## 5. Definition of Done
- ✅ Tasks 1–7 closed; tasks 8–12 present (8 rewritten, 9–12 pre-existing).
- ✅ Build + smoke + lint (52/0) + tests (225 pass / 1 skip / 0 fail) green.
- ✅ ROADMAP bug IDs annotated DONE/N/A/OPEN — §0 reality check stops re-litigation.
- ⏳ TODO before release: `npm run validate` full pass (typecheck + docs:build + package:validate); document server-side nonce/timestamp replay contract in `THREATMODEL.md`.
