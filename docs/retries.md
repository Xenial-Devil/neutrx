---
title: Retry Strategies
parent: Guides
nav_order: 4
---

# Retry Strategies
{: .no_toc }

1. TOC
{:toc}

---

Retries are **enabled by default** and apply only to idempotent methods unless you opt in otherwise. The retry engine wraps the bulkhead + adapter, so a retried request still respects concurrency limits and the circuit breaker.

## Defaults at a glance

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enableRetry` | `boolean` | `true` | Master toggle |
| `maxRetries` | `number` | `3` | Max retry attempts (after the first try) |
| `retryStrategy` | `'fixed' \| 'linear' \| 'exponential' \| 'fibonacci'` | `'exponential'` | Backoff curve |
| `retryDelay` | `number` (ms) | `1000` | Base delay |
| `maxRetryDelay` | `number` (ms) | `30000` | Delay cap |
| `retryJitter` | `boolean` | `true` | Add 0–1000 ms random jitter |
| `retryMethods` | `HttpMethod[]` | `['GET','HEAD','OPTIONS','PUT','DELETE']` | Methods eligible for retry |
| `retryableStatuses` | `number[]` | `[408,429,500,502,503,504]` | HTTP statuses that trigger a retry |
| `retryableCodes` | `string[]` | `['ECONNRESET','ETIMEDOUT','ECONNREFUSED','ENETUNREACH','ERR_HTTP2_STREAM_ERROR']` | Network error codes that trigger a retry |
| `retryBudget` | `RetryBudgetConfig` | — | Token-bucket cap on retries per scope |
| `shouldRetry` | `(error) => boolean` | — | Custom predicate (overrides default decision) |
| `onRetry` | `(event) => void \| Promise<void>` | — | Callback fired before each retry |

All options live under `resilience` in the client/request config.

## Backoff strategies

For attempt `n` (1-based), with `base = retryDelay` and added jitter:

| Strategy | Delay formula |
| --- | --- |
| `fixed` | `base + jitter` |
| `linear` | `base × n + jitter` |
| `exponential` *(default)* | `base × 2^(n-1) + jitter` |
| `fibonacci` | `base × fib(n) + jitter` |

Every result is capped at `maxRetryDelay`.

```ts
const api = neutrx.create({
  resilience: {
    maxRetries: 3,
    retryStrategy: 'exponential',
    retryDelay: 250,
    maxRetryDelay: 5_000,
    retryJitter: true,
    onRetry: ({ attempt, delay, error }) =>
      console.warn(`retry #${attempt} in ${delay}ms: ${error.message}`),
  },
});
```

## Idempotency: POST and PATCH

`POST` and `PATCH` are **not** retried by default. To make them retryable, pass an `idempotencyKey` — Neutrx sends it as the `Idempotency-Key` header (configurable via `idempotencyKeyHeader`) and treats the request as retryable when the failure is otherwise retryable.

```ts
await api.post('/payments', { amount: 42 }, {
  idempotencyKey: 'payment-2026-05-19-0001', // string, () => string, or true (auto-UUID)
});
```

{: .warning }
> Only set `idempotencyKey` when the upstream actually honors it. Retrying a non-idempotent write without server-side dedupe can double-charge or double-create.

## Never-retried errors

Security and validation failures are never retried, regardless of status/code:

`NeutrxSecurityError`, `NeutrxSSRFError`, `NeutrxInjectionError`, `NeutrxPrototypePollutionError`, `NeutrxValidationError`.

## Retry-After and deadlines

- A `Retry-After` header (seconds, HTTP-date, or ms) is respected and capped by `maxRetryDelay`.
- An `AbortSignal` stops active attempts **and** pending backoff.
- The request `timeout` acts as a total deadline across all attempts and backoff.

## Shared retry budget

A retry budget caps how many retries can happen per window, preventing retry storms when many requests fail at once.

```ts
const api = neutrx.create({
  resilience: {
    retryBudget: {
      maxRetries: 1000,
      windowMs: 60_000,
      scope: 'origin',          // 'client' (default) | 'origin' | 'global'
      namespace: 'billing-api',
      store: sharedRetryBudgetStore, // required for scope: 'global'
    },
  },
});
```

`scope: 'global'` needs an external `store` (sync or async). Core ships the interface only — Redis/networked state lives outside core. See [Config Reference → Distributed State](config-reference.md).

## When retries are exhausted

The final failure throws `NeutrxMaxRetriesError`:

| Field | Value |
| --- | --- |
| `code` | `'MAX_RETRIES_EXCEEDED'` |
| `category` | `'resilience'` |
| `retryable` | `false` |
| `attempts` | number of attempts made |
| `lastError` | the underlying error |

## Observe retries

```ts
const res = await api.get('/users');
console.log(res.attempts); // [{ attempt, duration, success, error? }, ...]

api.on('retry:recorded', ({ url, attempt }) => metrics.inc('retry', { url }));
console.log(api.getMetrics().requests.retried);
```

Retries also surface via the OpenTelemetry attribute `neutrx.retry.count`. See [Observability](observability.md).

## Related

- [Circuit Breaker](circuit-breaker.md) — stop hammering a downed upstream
- [Bulkhead Isolation](bulkhead-isolation.md) — bound concurrent retries
- [Config Reference](config-reference.md) — full resilience schema
