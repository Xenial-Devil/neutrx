---
title: Bulkhead Isolation
parent: Guides
nav_order: 6
---

# Bulkhead Isolation

Bulkheads limit concurrent work per target so one slow or overloaded upstream does not consume all outbound capacity.

```ts
const api = neutrx.create({
  baseURL: 'https://catalog.example.com',
  resilience: {
    enableBulkhead: true,
    maxConcurrent: 20,
    maxQueue: 50,
    bulkheadQueueTimeout: 5_000,
  },
});
```

Bulkhead isolation runs around the selected adapter alongside retries, circuit breaker checks, cache, and metrics. It is enabled by default in normalized resilience config; set it explicitly when a service needs a reviewed concurrency budget.

## How It Works

- Each target domain gets an independent pool.
- Active requests use pool slots up to `maxConcurrent`.
- Extra requests wait in the queue up to `maxQueue`.
- Queued requests fail with `NeutrxBulkheadError` after `bulkheadQueueTimeout`.
- `getBulkheadStats()` exposes active, queued, and current limit values by domain.

```ts
console.log(api.getBulkheadStats());
```

## Adaptive Concurrency

Adaptive concurrency can adjust limits based on observed latency:

```ts
const api = neutrx.create({
  resilience: {
    enableBulkhead: true,
    maxConcurrent: 20,
    adaptiveConcurrency: {
      enabled: true,
      initialLimit: 10,
      minLimit: 2,
      maxLimit: 50,
      targetLatency: 500,
      increaseStep: 1,
      decreaseRatio: 0.8,
    },
  },
});
```

Use adaptive concurrency for services where latency is a useful overload signal. Keep `minLimit` and `maxLimit` conservative until production metrics prove wider bounds are safe.

## Pair With Circuit Breaker

Bulkheads limit concurrency while an upstream is slow. Circuit breakers fail fast after repeated failures:

```ts
const api = neutrx.create({
  resilience: {
    enableBulkhead: true,
    maxConcurrent: 20,
    enableCircuitBreaker: true,
    failureThreshold: 5,
    circuitTimeout: 30_000,
  },
});
```

Use both for critical upstreams: bulkheads keep pressure bounded, and circuit breakers reduce work while the upstream is unhealthy.
