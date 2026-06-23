---
title: Request Batching (DataLoader)
description: "Batch and cache high-volume key lookups with Neutrx DataLoader-style request batching, key normalization, scheduling, and batch size bounds."
parent: Guides
nav_order: 9
---

# Request Batching with DataLoader

`DataLoader<K, V, C>` coalesces many individual `.load(key)` calls made within the same execution frame into a **single** batch function call, and (optionally) memoizes the result per key for the loader's lifetime. It is the classic batch-and-cache pattern, useful for collapsing N+1 request fan-out into one round trip.

It is a **standalone, opt-in utility** — nothing in the Neutrx request pipeline invokes it unless your code constructs a loader and calls `.load(...)`. It adds **zero runtime dependencies** and runs in both Node and the browser.

```ts
import { DataLoader } from 'neutrx';
```

## Why

Code paths often request the same resource one item at a time:

```ts
// N separate HTTP calls — one per id
const a = await api.get(`/users/${id1}`);
const b = await api.get(`/users/${id2}`);
```

Wrap the fetch in a loader and the per-item calls collapse into one batched request:

```ts
const userLoader = new DataLoader<string, User>(async ids => {
  const { data } = await api.get('/users', { params: { ids: ids.join(',') } });
  // Return one slot per id, aligned by index.
  return ids.map(id => data.find(u => u.id === id) ?? new Error(`no user ${id}`));
});

const [a, b] = await Promise.all([
  userLoader.load(id1),
  userLoader.load(id2),
]); // ONE GET /users?ids=id1,id2
```

## The batch function

```ts
type BatchLoadFn<K, V> = (keys: ReadonlyArray<K>) => Promise<ArrayLike<V | Error>>;
```

Rules:

- It receives the collected keys and **must resolve to a list of the same length**, in the same order. A wrong-length result rejects every key in that batch with a `TypeError`.
- Put an `Error` in slot `i` to reject only `keys[i]` — the rest of the batch still resolves.
- If the whole function rejects, every key in the batch rejects with that error.

## API

| Member | Description |
| --- | --- |
| `new DataLoader(batchFn, options?)` | Construct a loader. |
| `.load(key): Promise<V>` | Queue a key; identical keys in the same frame share one slot. |
| `.loadMany(keys): Promise<Array<V \| Error>>` | Load many; each slot resolves to a value **or** an `Error` (never throws). |
| `.clear(key): this` | Evict one key from the cache so its next load re-dispatches. |
| `.clearAll(): this` | Evict every cached key. |
| `.prime(key, value): this` | Seed the cache (value or `Error`) so `load(key)` resolves without a batch call. |
| `.name` | The optional `name` you passed, or `null`. |

## Options

```ts
interface DataLoaderOptions<K, V, C = K> {
  batch?: boolean;            // default true; false => one dispatch per load
  maxBatchSize?: number;      // split larger batches into chunks
  batchScheduleFn?: (cb: () => void) => void; // default: queueMicrotask
  cache?: boolean;            // default true; false => no memoization
  cacheKeyFn?: (key: K) => C; // map an object key to a primitive cache key
  cacheMap?: CacheMap<C, V> | null; // bring your own store (e.g. an LRU)
  name?: string;
}
```

### Object keys

When keys are objects, give a `cacheKeyFn` so structurally-equal keys hit the cache:

```ts
const loader = new DataLoader<{ org: string; id: string }, Doc>(
  batchFetchDocs,
  { cacheKeyFn: k => `${k.org}:${k.id}` },
);
```

### Bounding batch size

```ts
// At most 100 ids per upstream call; extra keys split into more batches.
new DataLoader(batchFetch, { maxBatchSize: 100 });
```

## Caching semantics

- Caching is **on by default** and lasts for the loader's lifetime — create a loader **per request / per unit of work**, not one global long-lived loader, to avoid serving stale data across users.
- A **rejected** load is **not** cached — the key auto-evicts so the next `load` retries.
- `prime(key, value)` will not overwrite an already-cached key; `clear(key)` first if you need to replace it.
- Set `cache: false` for a pure batching loader with no memoization.

```ts
loader.prime('1', { id: '1', name: 'Ada' }); // seed from a known value
loader.clear('1');                            // force a refetch next time
loader.clearAll();                            // after a mutation that invalidates everything
```

## Scheduling

By default a batch is dispatched on the **microtask queue** (`queueMicrotask`), so every `.load(...)` issued synchronously in the same frame is collected into one batch. Override `batchScheduleFn` to widen the window (e.g. batch across a short timer):

```ts
new DataLoader(batchFetch, {
  batchScheduleFn: cb => setTimeout(cb, 10), // 10ms collection window
});
```

## Notes

- Pure JS, zero dependencies, works in Node and the browser.
- It does **not** change any default request behavior — it only acts when you call `.load`.
- For de-duplicating *identical in-flight HTTP requests* automatically, see request [deduplication](cache.md) instead; DataLoader is for *aggregating distinct keys* into one batched call.
