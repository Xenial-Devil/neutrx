# Cache

Neutrx has an in-memory response cache for safe `GET` requests. Unsafe methods are not cached by the client.

```ts
const api = neutrx.create({
  performance: {
    enableCaching: true,
    deduplicateRequests: true,
    deduplicateRequestKey: config => `${config.method}:${config.url}:${config.headers.get('X-Tenant-ID') ?? ''}`,
    cacheStrategy: 'swr',
    cacheTTL: 300_000,
    revalidateAfter: 60_000,
    cacheStaleMax: 1_500_000,
    cacheMaxSize: 500,
    cacheMaxEntrySize: 1_048_576,
    respectCacheHeaders: true,
    onRevalidate(event) {
      console.log(event.url, event.updated, event.status);
    },
  },
});
```

Cache behavior:

- caches successful `GET` responses only
- includes URL, `Accept`, and `Authorization` in the cache key
- skips `no-store`, `no-cache`, and `private`
- respects `Cache-Control: max-age` and `Expires` when enabled
- returns `response.cached` and `response.cacheAge` on hits
- returns `response.stale` and `x-cache: STALE` for SWR hits
- shares identical inflight `GET`/`HEAD` requests when `deduplicateRequests` is enabled; joined responses set `response.deduplicated`
- lets you customize deduplication with `deduplicateRequestKey`, `deduplicateMethods`, and `deduplicateHeaders`
- counts joined requests in `api.getMetrics().requests.deduplicated` and `neutrx_deduplication_hits_total`
- accepts `performance.cacheAdapter` for custom process-local stores with optional `lock`/`unlock`

```ts
await api.get('/catalog');
console.log(api.getCacheStats());
api.clearCache();
api.invalidateCache(/\/catalog/u);
api.deleteCacheEntry('/catalog');
```

Cache strategies:

- `max-age`: return fresh cache hits until normal max-age expiry, then use the network.
- `swr`: return fresh hits immediately; after `revalidateAfter` or normal max-age expiry, return stale data immediately with `response.cached = true` and `response.stale = true` while one background refresh updates the cache.
- `network-first`: try the network first and fall back to a cached response when the network request fails.

`cacheTTL` is the default max-age when upstream headers do not provide one. `revalidateAfter` is an optional SWR freshness boundary; when omitted, normal max-age controls freshness. `cacheStaleMax` keeps stale SWR entries usable for a bounded window. Existing `ttl` and `stale-while-revalidate` strategy names are accepted as compatibility aliases for `max-age` and `swr`.

The default deduplication key includes method, final URL with serialized params, response type, adapter, socket path, and selected headers (`Accept`, `Authorization`, and `Range`). Coalescing methods beyond `GET` and `HEAD` is opt-in; include an idempotency key or another application-safe discriminator in `deduplicateRequestKey` when enabling it.

Requests with cancellation signals are never deduplicated, and requests with non-keyable transport overrides are not deduplicated by the default key. This keeps one caller's cancellation, proxy, TLS, agent, lookup, redirect hook, fetch implementation, or bandwidth controls from changing another caller's request. Keyable timeout, redirect-limit, response-limit, proxy-disable, and HTTP/2 settings are included in the default key. Use a custom `deduplicateRequestKey` only when other transport differences are intentionally equivalent.

Custom adapter shape:

```ts
const api = neutrx.create({
  performance: {
    cacheAdapter: {
      get: key => store.get(key),
      set: (key, value) => store.set(key, value),
      delete: key => store.delete(key),
      clear: () => store.clear(),
      keys: () => store.keys(),
      lock: key => lockOnce(key),
      unlock: key => unlock(key),
    },
  },
});
```

Core stays synchronous and dependency-free. Redis or other networked stores should live in optional packages that can own async locking, serialization, and peer dependencies.
