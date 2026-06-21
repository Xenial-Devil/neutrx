---
title: Home
nav_order: 1
---

# Neutrx
{: .fs-9 }

Security-first, zero-runtime-dependency TypeScript HTTP client for Node.js 18+ backends — Axios-like ergonomics with SSRF protection, redirect safety, resilience, and typed redacted errors.
{: .fs-6 .fw-300 }

[Get Started](getting-started.md){: .btn .btn-primary .mr-2 }
[Why Neutrx](why-neutrx.md){: .btn .mr-2 }
[API Reference](api.md){: .btn .mr-2 }
[GitHub](https://github.com/Xenial-Devil/neutrx){: .btn }

---

## Install

```bash
npm install neutrx
```

Requires **Node.js `>= 18`**. Zero runtime dependencies. Ships ESM + CommonJS + `.d.ts`, plus a separate browser build.

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  security: { profile: 'standard' },
});

const { data } = await api.get('/users/1');
```

{: .note }
> Neutrx is callable **and** an object: `neutrx(url)`, `neutrx.get(url)`, and `neutrx.create(config)` all work. The default export is a global instance; `create()` returns an isolated client with its own defaults, cache, circuit state, and metrics.

## What you get

| Area | Highlights |
| --- | --- |
| 🛡️ **Security by default** | SSRF + DNS-pinning (TOCTOU-safe), redirect-downgrade protection, credential stripping on cross-origin hops, cloud-metadata blocking, dangerous-port blocking, TLS controls + cert pinning, size/timeout caps. Profiles: `strict` / `standard` / `legacy`. → [Security](security-model.md) |
| 🔁 **Resilience** | Retries with 4 backoff strategies + jitter + budgets, per-origin circuit breaker, per-origin bulkhead with optional adaptive concurrency — no retry storms. → [Retry Strategies](retries.md) |
| ⚡ **Performance** | Response caching (Cache-Control, SWR, stale-if-error, network-first), in-flight deduplication, async pagination, DataLoader batching. → [Cache & Deduplication](cache.md) |
| 🔌 **Extensible** | Plugin SDK (`beforeRequest`/`afterRequest`/`onError`) + first-party plugins: AWS SigV4, HAR recording, OpenTelemetry, W3C/B3 trace context, validation, logging, mocks, GraphQL, OAuth2. → [Plugins](plugins.md) |
| 🧭 **Observable** | Metrics with latency percentiles, Prometheus export, structured redacting errors, OTel client-span bridge, trace-context propagation. → [Observability](observability.md) |
| 🌐 **Node + Browser** | Shared request API across a Node build and a browser build, with honest platform limits (no SSRF/DNS/TLS guarantees in the browser). → [Browser Usage](browser-usage.md) |

## A fuller example

```ts
import neutrx, { isNeutrxError, NeutrxHTTPError } from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://billing.example.com',
  timeout: 8_000,
  security: { profile: 'standard', allowedHosts: ['billing.example.com'] },
  resilience: {
    maxRetries: 3,
    retryStrategy: 'exponential',
    failureThreshold: 5,
    maxConcurrent: 10,
  },
  performance: { cacheStrategy: 'swr', cacheTTL: 60_000 },
});

try {
  const { data, status, cached } = await api.get('/invoices', { params: { page: 1 } });
  console.log(status, cached, data);
} catch (error) {
  if (!isNeutrxError(error)) throw error;
  console.error(error.code, error.category, error.toJSON()); // secrets redacted
  if (error instanceof NeutrxHTTPError) console.error('HTTP', error.status);
}
```

## Where to go next

| Goal | Read |
| --- | --- |
| Send your first request | [Getting Started](getting-started.md) |
| Build a Node service client | [Node Usage](node-usage.md) |
| Docker sockets, proxies, enterprise egress | [Node Infrastructure](node-infrastructure.md) |
| Understand the security model | [Security](security-model.md) · [Security Features](security-features.md) |
| Migrate an Axios codebase | [Migration](axios-migration.md) |
| Add retries without retry storms | [Retry Strategies](retries.md) |
| Fail fast during upstream incidents | [Circuit Breaker](circuit-breaker.md) |
| Cap concurrency per origin | [Bulkhead Isolation](bulkhead-isolation.md) |
| Cache + revalidate responses | [Cache & Deduplication](cache.md) |
| Walk paged endpoints | [Pagination](pagination.md) |
| Batch N+1 fan-out into one call | [Request Batching (DataLoader)](data-loader.md) |
| Share state across processes (Redis) | [Config Reference → Distributed State](config-reference.md) |
| Tracing, logging, validation, mocks | [Plugins](plugins.md) |
| Every config option | [Config Reference](config-reference.md) · [API Reference](api.md) |

## Project facts

- **License:** MIT
- **Runtime deps:** none (optional `@opentelemetry/api` peer, detected lazily)
- **Node:** `>= 18`
- **Entry points:** `neutrx`, `neutrx/node`, `neutrx/browser`, `neutrx/plugins`, `neutrx/errors`, `neutrx/headers`, `neutrx/adapters`, `neutrx/instrumentation`
- [Changelog](https://github.com/Xenial-Devil/neutrx/blob/main/CHANGELOG.md) · [npm](https://www.npmjs.com/package/neutrx) · [Report an issue](https://github.com/Xenial-Devil/neutrx/issues)
</content>
</invoke>
