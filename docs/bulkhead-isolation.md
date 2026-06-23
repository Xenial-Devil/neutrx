---
title: Bulkhead Isolation
description: "Limit concurrent outbound calls per origin with Neutrx bulkhead isolation, queueing, adaptive concurrency, and circuit breaker pairing."
parent: Guides
nav_order: 6
---

# Bulkhead Isolation
{: .no_toc }

1. TOC
{:toc}

---

A bulkhead limits **concurrent work per target origin** so one slow or overloaded upstream can't consume all your outbound capacity. It runs around the adapter alongside retries, the circuit breaker, cache, and metrics, and is **enabled by default**.

## Defaults

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enableBulkhead` | `boolean` | `true` | Master toggle |
| `maxConcurrent` | `number` | `10` | Max in-flight requests per origin |
| `maxQueue` | `number` | `100` | Max queued requests per origin |
| `bulkheadQueueTimeout` | `number` (ms) | `30000` | How long a request may wait in queue |
| `adaptiveConcurrency` | `AdaptiveConcurrencyConfig` | — | Optional dynamic limit tuning |

```ts
const api = neutrx.create({
  baseURL: 'https://catalog.example.com',
  resilience: {
    maxConcurrent: 20,
    maxQueue: 50,
    bulkheadQueueTimeout: 5_000,
  },
});
```

## How it works

- Each target **domain** gets an independent pool with its own `active`, `queue`, and `limit`.
- Requests run while `active < limit`; beyond that they queue.
- When the queue is full (`queue.length >= maxQueue`), new requests fail **immediately** with `NeutrxBulkheadError` (`code: 'BULKHEAD_FULL'`).
- A queued request that waits longer than `bulkheadQueueTimeout` fails with `NeutrxBulkheadError` (`code: 'BULKHEAD_QUEUE_TIMEOUT'`).

Both errors have `category: 'resilience'` and `retryable: true`.

```ts
console.log(api.getBulkheadStats());
// { domains: { 'catalog.example.com': { active, queued, limit, adaptive? } } }
```

## Adaptive concurrency

Let the pool grow when the upstream is healthy and shrink when it slows:

```ts
const api = neutrx.create({
  resilience: {
    maxConcurrent: 20,
    adaptiveConcurrency: {
      enabled: true,
      initialLimit: 10,
      minLimit: 2,
      maxLimit: 50,
      targetLatency: 500,  // ms
      increaseStep: 1,
      decreaseRatio: 0.7,
    },
  },
});
```

| Option | Default | Effect |
| --- | --- | --- |
| `minLimit` | `1` | Floor for the limit |
| `maxLimit` | `maxConcurrent` | Ceiling for the limit |
| `targetLatency` | `500` ms | Latency goal |
| `increaseStep` | `1` | Added on a fast success |
| `decreaseRatio` | `0.7` | Multiplied on slow/failed requests |

Behavior: on success with latency ≤ `targetLatency`, `limit += increaseStep`; on failure or latency > target, `limit = floor(limit × decreaseRatio)`; always clamped to `[minLimit, maxLimit]`.

{: .tip }
> Keep `minLimit`/`maxLimit` conservative until production metrics prove wider bounds are safe.

## Pair with the circuit breaker

```ts
const api = neutrx.create({
  resilience: {
    maxConcurrent: 20,        // bound pressure while upstream is slow
    failureThreshold: 5,      // fail fast once it's clearly down
    circuitTimeout: 30_000,
  },
});
```

- **Bulkhead** keeps concurrency bounded while an upstream is *slow*.
- **Circuit breaker** stops work entirely while an upstream is *failing*.

See [Circuit Breaker](circuit-breaker.md) and [Retry Strategies](retries.md).
