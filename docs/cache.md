# Cache

Neutrx has an in-memory response cache for safe `GET` requests. Unsafe methods are not cached by the client.

```ts
const api = neutrx.create({
  performance: {
    enableCaching: true,
    cacheTTL: 300_000,
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

```ts
await api.get('/catalog');
console.log(api.getCacheStats());
api.clearCache();
```

This cache is process-local. Redis and distributed cache adapters are planned extension points, not current runtime features.
