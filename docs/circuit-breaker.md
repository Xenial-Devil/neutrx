---
title: Circuit Breaker
description: "Protect upstream services with Neutrx circuit breakers, failure thresholds, half-open probes, state inspection, and shared worker state."
parent: Guides
nav_order: 5
---

# Circuit Breaker
{: .no_toc }

1. TOC
{:toc}

---

The circuit breaker is **enabled by default** and scoped **per target origin**. When an upstream starts failing, the breaker trips and short-circuits further calls so you stop wasting time and connections on a service that's already down.

## Defaults

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enableCircuitBreaker` | `boolean` | `true` | Master toggle |
| `failureThreshold` | `number` | `5` | Consecutive failures before the circuit opens |
| `successThreshold` | `number` | `2` | Successes in `HALF_OPEN` required to close |
| `circuitTimeout` | `number` (ms) | `60000` | Time in `OPEN` before a probe (`HALF_OPEN`) |
| `circuitBreakerStorage` | `CircuitBreakerStorageConfig` | — | Optional shared state store |

```ts
const api = neutrx.create({
  resilience: {
    failureThreshold: 5,
    successThreshold: 2,
    circuitTimeout: 30_000,
  },
});
```

## States

| State | Behavior |
| --- | --- |
| `CLOSED` | Normal — requests flow through. |
| `OPEN` | Requests fail fast with `NeutrxCircuitBreakerError`; no network I/O. |
| `HALF_OPEN` | After `circuitTimeout`, a limited number of probe requests test recovery. Successes (`successThreshold`) close the circuit; a failure re-opens it. |

## When the circuit is open

```ts
import { NeutrxCircuitBreakerError } from 'neutrx';

try {
  await api.get('/users');
} catch (error) {
  if (error instanceof NeutrxCircuitBreakerError) {
    console.warn(`circuit open, retry after ${error.retryAfter}ms`);
  }
}
```

| Field | Value |
| --- | --- |
| `code` | `'CIRCUIT_OPEN'` |
| `category` | `'resilience'` |
| `retryable` | `false` |
| `retryAfter` | ms until the next probe is allowed |

{: .important }
> Don't retry through an open circuit from application code — let it recover via its own timeout. Stacking app-level retries on top of the breaker defeats the purpose.

## Inspect circuit state

```ts
api.getCircuitStatus('https://api.example.com/users');
// { state: 'OPEN', failures: 5, openedAt: 1718000000000, lastFailure: ... }

api.getCircuitStatus();
// Record<origin, CircuitStatus> for every tracked origin

api.on('request:error', ({ url, error }) => console.error(url, error.code));
```

## Share state across workers

By default each process has its own breaker. To trip the circuit cluster-wide, supply a store:

```ts
const api = neutrx.create({
  resilience: {
    circuitBreakerStorage: {
      store: sharedCircuitStateStore, // sync or async CircuitStateStore
      scope: 'origin',                // 'origin' (default) | 'global'
      namespace: 'billing-api',
    },
  },
});
```

The store interface is `get(key)` / `set(key, value)` / optional `delete` / `keys`. Keys follow `neutrx:{namespace}:circuit:{scope}:{target}`. Core ships no Redis client — see [Config Reference → Distributed State](config-reference.md) and the [Redis adapter](node-infrastructure.md).

## Pair with retries and bulkhead

Use all three together for critical upstreams:

```ts
const api = neutrx.create({
  resilience: {
    maxRetries: 2,            // recover from transient blips
    failureThreshold: 5,     // give up fast once it's clearly down
    circuitTimeout: 30_000,
    maxConcurrent: 10,       // bound pressure while it's slow
  },
});
```

- **Retries** smooth over transient errors.
- **Circuit breaker** stops the bleeding once failures are sustained.
- **Bulkhead** keeps a slow upstream from starving everything else.

See [Bulkhead Isolation](bulkhead-isolation.md) and [Retry Strategies](retries.md).
