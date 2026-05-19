# Retries

Retries are enabled by default and apply only to idempotent methods unless configured otherwise.

Default retry methods:

- `GET`
- `HEAD`
- `OPTIONS`
- `PUT`
- `DELETE`

`POST` and `PATCH` are not retried by default. Enable them only when the upstream API supports idempotency keys or equivalent guarantees.

```ts
const api = neutrx.create({
  resilience: {
    enableRetry: true,
    maxRetries: 3,
    retryStrategy: 'exponential',
    retryDelay: 250,
    maxRetryDelay: 5_000,
    retryJitter: true,
    retryBudget: { maxRetries: 100, windowMs: 60_000 },
  },
});
```

Retry behavior:

- retryable HTTP statuses: `408`, `429`, `500`, `502`, `503`, `504`
- retryable network codes: `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `ENETUNREACH`
- `Retry-After` is respected and capped by `maxRetryDelay`
- `AbortSignal` stops active attempts and retry backoff
- request timeout is treated as a total deadline for retry backoff

Observe retries through `response.attempts`, `getMetrics().requests.retried`, `request:success` events, and OpenTelemetry attribute `neutrx.retry.count`.
