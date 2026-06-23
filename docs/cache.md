---
title: Cache & Deduplication
description: "Use Neutrx response caching and in-flight request deduplication with Cache-Control, stale-while-revalidate, stale-if-error, custom stores, and metrics."
parent: Guides
nav_order: 7
---

# Cache & Deduplication
{: .no_toc }

1. TOC
{:toc}

---

Neutrx ships an in-memory response cache and in-flight request deduplication. Both are **on by default** for safe methods and are configured under `performance`.

## Response cache

```ts
const api = neutrx.create({
  performance: {
    enableCaching: true,
    cacheStrategy: 'swr',
    cacheTTL: 300_000,        // default max-age when upstream sends none (ms)
    revalidateAfter: 60_000,  // optional SWR freshness boundary
    cacheStaleMax: 1_500_000, // max window stale SWR entries stay usable
    cacheMaxSize: 500,        // max entries
    cacheMaxEntrySize: 1_048_576, // 1 MB per entry
    respectCacheHeaders: true,
    onRevalidate: e => console.log(e.url, e.updated, e.status),
  },
});
```

### Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enableCaching` | `boolean` | `true` | Master toggle |
| `cacheStrategy` | `'max-age' \| 'swr' \| 'network-first'` | `'max-age'` | Freshness policy (see below) |
| `cacheTTL` | `number` (ms) | `300000` | Default max-age when upstream omits one |
| `revalidateAfter` | `number` (ms) | — | SWR freshness cap before background refresh |
| `cacheStaleMax` | `number` (ms) | `max(cacheTTL, 1500000)` | Bounded window stale entries remain usable |
| `cacheMaxSize` | `number` | `500` | Max cached entries (LRU eviction) |
| `cacheMaxEntrySize` | `number` (bytes) | `1048576` | Skip caching responses larger than this |
| `respectCacheHeaders` | `boolean` | `true` | Honor `Cache-Control` + `Expires` |
| `cacheAdapter` | `CacheStore` | in-memory | Custom process-local store |
| `onRevalidate` | `(event) => void` | — | Fires after a background revalidation |

{: .note }
> `ttl` and `stale-while-revalidate` are accepted as compatibility aliases for `max-age` and `swr`.

### What gets cached

- Only successful **2xx** responses, for cacheable methods (`GET` by default).
- The cache key is a SHA-256 of `{ socketPath, url, Accept, Authorization }` — so per-user/per-tenant responses don't collide.
- `Cache-Control: no-store`, `no-cache`, and `private` skip caching entirely.
- `max-age` / `Expires` (when `respectCacheHeaders`) override `cacheTTL`.

On a hit, the response carries `cached: true`, plus `cacheAge` and (for stale serves) `stale: true` with an `x-cache: STALE` header.

### Strategies

| Strategy | Behavior |
| --- | --- |
| `max-age` *(default)* | Serve fresh hits until expiry; then go to network. |
| `swr` | Serve fresh hits immediately. After `revalidateAfter` / max-age, return **stale** data immediately (`cached: true`, `stale: true`) while **one** background request revalidates. Conditional `If-None-Match` / `If-Modified-Since` are sent automatically. |
| `network-first` | Try the network first; on network failure fall back to a cached entry within its stale window. |

**stale-if-error** is always available: if the network fails and a cached entry is within its `stale-if-error` window (from the `Cache-Control` directive), Neutrx serves it with `x-cache: STALE-IF-ERROR` and a `Warning: 110` header rather than throwing.

### Manage the cache

```ts
await api.get('/catalog');
api.getCacheStats();          // { hits, misses, evictions, size, hitRate, ... }
api.clearCache();             // clear all
api.invalidateCache(/\/catalog/u); // by pattern
api.deleteCacheEntry('/catalog');  // single entry
```

### Custom cache store

```ts
const api = neutrx.create({
  performance: {
    cacheAdapter: {
      get: key => store.get(key),
      set: (key, value) => store.set(key, value),
      delete: key => store.delete(key),
      clear: () => store.clear(),
      keys: () => store.keys(),
      lock: key => lockOnce(key),   // optional: single-flight revalidation
      unlock: key => unlock(key),   // optional
    },
  },
});
```

{: .important }
> Core stays synchronous and dependency-free. Redis or other networked stores belong in optional packages that own async locking, serialization, and peer dependencies.

## Request deduplication

Identical in-flight requests are coalesced into one network call; the joiners get a clone with `deduplicated: true`.

| Option | Type | Default |
| --- | --- | --- |
| `deduplicateRequests` | `boolean` | `true` |
| `deduplicateMethods` | `HttpMethod[]` | `['GET', 'HEAD']` |
| `deduplicateHeaders` | `string[]` | `['accept', 'authorization', 'range']` |
| `deduplicateRequestKey` | `(config) => string \| null \| undefined` | — (default key) |

```ts
const api = neutrx.create({
  performance: {
    deduplicateRequestKey: c =>
      `${c.method}:${c.url}:${c.headers.get('X-Tenant-ID') ?? ''}`,
  },
});
```

The default key includes method, final URL with serialized params, response type, adapter, socket path, the keyable transport limits (timeout, redirect/response limits, proxy-disabled, HTTP/2 settings), and the selected headers.

{: .warning }
> Requests with a cancellation `signal`/`cancelToken`, `responseType: 'stream'`, or non-keyable transport overrides (custom `proxy`, `tls`, agents, `lookup`, `fetch`, redirect hook, `maxRate`) are **never** deduplicated by the default key — so one caller's cancellation or transport can't change another's. Return `null` from `deduplicateRequestKey` to skip dedup for a request.

Coalescing methods beyond `GET`/`HEAD` is opt-in; only do it when the requests are genuinely equivalent (e.g. include an idempotency key in your custom key).

Joined requests count in `api.getMetrics().requests.deduplicated` and the `neutrx_deduplication_hits_total` Prometheus counter, and emit a `deduplication:hit` event. See [Observability](observability.md).

## Related

- [Pagination](pagination.md) · [Request Batching (DataLoader)](data-loader.md)
- [Config Reference](config-reference.md) — full performance schema
