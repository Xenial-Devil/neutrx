---
title: Getting Started
description: "Install Neutrx, send your first request, create secure clients, choose security profiles, handle redacted errors, and add retries or caching."
nav_order: 2
---

# Getting Started
{: .no_toc }

1. TOC
{:toc}

---

## Install

```bash
npm install neutrx
```

Neutrx supports **Node.js `>= 18`** and has **zero runtime dependencies**. The package ships ESM, CommonJS, and `.d.ts` for multiple entry points: `neutrx` (default/Node), `neutrx/node`, `neutrx/browser`, `neutrx/plugins`, `neutrx/errors`, `neutrx/headers`, `neutrx/adapters`, and `neutrx/instrumentation`.

```ts
import neutrx from 'neutrx';        // ESM
const neutrx = require('neutrx');   // CommonJS — the default export is callable
```

## Your first request

The default export is a ready-to-use global client. It is both **callable** and an **object**:

```ts
import neutrx from 'neutrx';

await neutrx('https://api.example.com/health');         // callable form
await neutrx.get('https://api.example.com/users/1');    // verb method
const { data } = await neutrx.post('https://api.example.com/users', { name: 'Ada' });
```

A successful call resolves to a `NeutrxResponse`:

```ts
const res = await neutrx.get('https://api.example.com/users/1');
res.data;        // parsed body (JSON by default)
res.status;      // 200
res.statusText;  // 'OK'
res.headers;     // Headers
res.config;      // resolved request config
res.timing;      // { duration: <ms> }
res.requestId;   // unique id
res.cached;      // true if served from cache
res.attempts;    // retry attempt log (if any)
```

## Create a dedicated client

Use **one shared client per upstream service**. Put service-wide defaults on the client, then override only request-specific fields per call.

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,        // overall deadline (ms), default 30_000
  connectTimeout: 2_000,  // TCP/TLS handshake budget (ms), default 10_000
  headers: { 'user-agent': 'my-service/1.0' },
  security: { profile: 'standard' },
});

const users = await api.get('/users', { params: { page: 1 } });
const created = await api.post('/users', { name: 'Ada Lovelace' });
```

{: .tip }
> `create()` returns an isolated client: its own defaults, cache, circuit-breaker state, bulkhead pools, and metrics. Don't reach for a fresh client per request — that throws away cache hits, circuit state, and connection reuse.

## Pick a security profile

Every request runs through the [SecurityManager](security-features.md). The profile sets the baseline; you can override individual options.

```ts
// Normal production service-to-service traffic.
const internal = neutrx.create({
  baseURL: 'https://orders.internal',
  security: { profile: 'standard' },
});

// User-controlled / webhook / partner URLs — lock it down.
const outbound = neutrx.create({
  security: { profile: 'strict' },
  egressPolicy: { mode: 'webhook-target', allowedPorts: [443] },
});
```

| Profile | Use it for | Behavior |
| --- | --- | --- |
| `strict` | User-controlled or high-risk outbound URLs | HTTPS only, blocks private/loopback/link-local/metadata IPs and dangerous ports |
| `standard` *(default)* | Normal production service-to-service traffic | HTTP+HTTPS, still blocks private/metadata IPs and dangerous ports |
| `legacy` | Trusted migrations, local testing | Relaxes SSRF/HTTPS/port blocks; allows localhost and URL credentials |

{: .danger }
> `legacy` disables SSRF protection. Never point a `legacy` client at user-influenced URLs. See [Security Features](security-features.md) for the exact per-profile defaults.

## Handle errors safely

Every failure is a typed `NeutrxError` subclass with a stable `code`, a `category`, and a redacting `toJSON()`.

```ts
import { isNeutrxError, NeutrxHTTPError, NeutrxTimeoutError } from 'neutrx';

try {
  await api.get('/users');
} catch (error) {
  if (!isNeutrxError(error)) throw error;

  console.error(error.code, error.category); // e.g. 'HTTP_4XX', 'http'
  console.error(error.toJSON());             // secrets redacted in URLs/headers/context

  if (error instanceof NeutrxHTTPError) console.error('status', error.status);
  if (error instanceof NeutrxTimeoutError) console.error('phase', error.phase);
}
```

{: .important }
> Prefer `error.toJSON()` (or `toStructuredError(error)`) for logs. It redacts `authorization`, `cookie`, `token`, `password`, `secret`, `api-key`, and similar fields from URLs, headers, response data, and error context. See [Errors](errors.md).

## Add resilience and caching

```ts
const api = neutrx.create({
  baseURL: 'https://api.example.com',
  resilience: {
    maxRetries: 3,            // default 3
    retryStrategy: 'exponential',
    failureThreshold: 5,     // open circuit after 5 failures
    maxConcurrent: 10,       // per-origin bulkhead limit
  },
  performance: {
    cacheStrategy: 'swr',    // serve stale, revalidate in background
    cacheTTL: 60_000,        // ms
  },
});
```

Retries only apply to idempotent methods (`GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`) and retryable statuses by default. See [Retry Strategies](retries.md), [Circuit Breaker](circuit-breaker.md), and [Bulkhead Isolation](bulkhead-isolation.md).

## CommonJS and TypeScript

```js
// CommonJS — the require() default is callable thanks to the interop shim.
const neutrx = require('neutrx');
neutrx.get('https://api.example.com/health').then(r => console.log(r.status));
```

Neutrx is written in strict TypeScript and ships full declarations. Response data is typed via generics and optional schema validation:

```ts
interface User { id: number; name: string }
const { data } = await api.get<User>('/users/1'); // data: User
```

## Next steps

- [Node Usage](node-usage.md) — the backend-first feature set
- [Node Infrastructure](node-infrastructure.md) — sockets, proxies, TLS, egress
- [Security Features](security-features.md) — profiles and SSRF in depth
- [Migration](axios-migration.md) — moving from Axios
- [Config Reference](config-reference.md) — every option
- [API Reference](api.md) — methods, types, and the response shape
