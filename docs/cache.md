# Cache

Neutrx has an in-memory response cache for safe `GET` requests. Unsafe methods are not cached by the client.

```ts
const api = neutrx.create({
  performance: {
    enableCaching: true,
    deduplicateRequests: true,
    cacheStrategy: 'stale-while-revalidate',
    cacheTTL: 300_000,
    cacheStaleMax: 1_500_000,
    cacheMaxSize: 500,
    cacheMaxEntrySize: 1_048_576,
    respectCacheHeaders: true,
  },
});
```

Cache behavior:

- caches successful `GET` responses only
- includes URL, `Accept`, and `Authorization` in the cache key
- skips `no-store`, `no-cache`, and `private`
- respects `Cache-Control: max-age` and `Expires` when enabled
- returns `response.cached` and `response.cacheAge` on hits
- returns `response.stale` and `x-cache: STALE` for stale-while-revalidate hits
- shares identical inflight `GET`/`HEAD` requests when `deduplicateRequests` is enabled; joined responses set `response.deduplicated`
- accepts `performance.cacheAdapter` for custom process-local stores with optional `lock`/`unlock`

```ts
await api.get('/catalog');
console.log(api.getCacheStats());
api.clearCache();
```

`cacheStrategy: 'stale-while-revalidate'` keeps expired entries usable until `cacheStaleMax`. Neutrx returns stale data immediately and starts one background refresh for that cache key.

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
