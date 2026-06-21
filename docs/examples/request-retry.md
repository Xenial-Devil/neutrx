---
title: Request Retry
parent: Examples
nav_order: 4
---

# Request Retry

Retries are enabled by default for idempotent methods. Configure the retry budget and delay behavior on the client.

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://catalog.example.com',
  timeout: 8_000,
  security: { profile: 'standard' },
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
      namespace: 'catalog-api',
    },
  },
});

export async function listProducts() {
  const response = await api.get('/products');
  console.log(response.attempts);
  return response.data;
}
```

For `POST` and `PATCH`, use `idempotencyKey` only when the upstream API treats duplicate keys as one operation:

```ts
await api.post('/payments', { amount: 42 }, {
  idempotencyKey: crypto.randomUUID(),
});
```
