---
title: Retry Strategies
parent: Guides
nav_order: 4
---

# Retries

Retries are enabled by default and apply only to idempotent methods unless configured otherwise.

Default retry methods:

- `GET`
- `HEAD`
- `OPTIONS`
- `PUT`
- `DELETE`

`POST` and `PATCH` are not retried by default. Set `idempotencyKey` when the upstream API supports idempotency keys; Neutrx sends `Idempotency-Key` and treats that request as retryable when the failure is otherwise retryable.

```ts
const api = neutrx.create({
  resilience: {
    enableRetry: true,
    maxRetries: 3,
    retryStrategy: 'exponential',
    retryDelay: 250,
    maxRetryDelay: 5_000,
    retryJitter: true,
    retryBudget: {
      maxRetries: 100,
      windowMs: 60_000,
      scope: 'origin',
      namespace: 'billing-api',
    },
  },
});
```

```ts
await api.post('/payments', { amount: 42 }, {
  idempotencyKey: 'payment-2026-05-19-0001',
});
```

Retry behavior:

- retryable HTTP statuses: `408`, `429`, `500`, `502`, `503`, `504`
- retryable network codes: `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `ENETUNREACH`, `ERR_HTTP2_STREAM_ERROR`
- `Retry-After` is respected and capped by `maxRetryDelay`
- `AbortSignal` stops active attempts and retry backoff
- request timeout is treated as a total deadline for retry backoff

Observe retries through `response.attempts`, `getMetrics().requests.retried`, `request:success` events, and OpenTelemetry attribute `neutrx.retry.count`.

## Shared Retry Budget

```ts
const api = neutrx.create({
  resilience: {
    retryBudget: {
      maxRetries: 1000,
      windowMs: 60_000,
      scope: 'origin',
      namespace: 'billing-api',
      store: sharedRetryBudgetStore,
    },
  },
});
```

`store.consume(key, limit, windowMs, now)` may be sync or async. Core provides interface only; Redis or other networked state stays outside core.
