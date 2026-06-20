---
title: Home
nav_order: 1
---

# Neutrx
{: .fs-9 }

Security-first, zero-runtime-dependency HTTP client for Node.js 18+ backends — Axios-like ergonomics with SSRF protection, redirect safety, resilience, and typed redacted errors.
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

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  security: { profile: 'strict' },
});

const { data } = await api.get('/users/1');
```

## What you get

| Area | Highlights |
| --- | --- |
| 🛡️ **Security by default** | SSRF + DNS-pinning, redirect-downgrade protection, credential stripping on cross-origin hops, TLS controls, size/timeout caps. Profiles: `strict` / `standard` / `legacy`. → [Security Model](security-model.md) |
| 🔁 **Resilience** | Retries with backoff + budgets, circuit breaker, bulkhead isolation per origin — no retry storms. → [Retry Strategies](retries.md) |
| ⚡ **Performance** | Response caching (Cache-Control + SWR), in-flight deduplication, pagination, DataLoader batching. → [Cache & Deduplication](cache.md) |
| 🔌 **Extensible** | Plugin SDK + first-party plugins: AWS SigV4, HAR recording, OpenTelemetry, W3C trace context, validation, logging. → [Plugins](plugins.md) |
| 🧭 **Observable** | OTel-friendly hooks, metrics, structured redacting errors, trace-context propagation. → [Observability](observability.md) |
| 🌐 **Node + Browser** | Shared request API across a Node build and a browser build, with honest platform limits. → [Browser Usage](browser-usage.md) |

## Common paths

| Goal | Read |
| --- | --- |
| Build a Node service client | [Node Usage](node-usage.md) |
| Docker sockets, proxies, enterprise egress | [Node Infrastructure](node-infrastructure.md) |
| Migrate an Axios codebase | [Axios Migration](axios-migration.md) |
| Add retries without retry storms | [Retry Strategies](retries.md) |
| Fail fast during upstream incidents | [Circuit Breaker](circuit-breaker.md) |
| Cap concurrency per origin | [Bulkhead Isolation](bulkhead-isolation.md) |
| Walk paged endpoints | [Pagination](pagination.md) |
| Batch N+1 fan-out into one call | [Request Batching (DataLoader)](data-loader.md) |
| Share state across processes (Redis) | [Distributed State](config-reference.md#distributed-state-stateadapter) |
| Tracing, logging, validation, mocks | [Plugins](plugins.md) |

## Project

- **License:** MIT
- **Runtime deps:** none (optional `@opentelemetry/api` peer)
- **Node:** `>= 18`
- [Changelog](https://github.com/Xenial-Devil/neutrx/blob/main/CHANGELOG.md) · [npm](https://www.npmjs.com/package/neutrx) · [Report an issue](https://github.com/Xenial-Devil/neutrx/issues)
