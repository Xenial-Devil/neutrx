---
title: Circuit Breaker
parent: Guides
nav_order: 5
---

# Circuit Breaker

Circuit breaking is enabled by default and tracked per target host.

```ts
const api = neutrx.create({
  resilience: {
    enableCircuitBreaker: true,
    failureThreshold: 5,
    successThreshold: 2,
    circuitTimeout: 30_000,
    circuitBreakerStorage: {
      store: sharedCircuitStateStore,
      scope: 'origin',
      namespace: 'billing-api',
    },
  },
});
```

States:

- `CLOSED`: requests flow normally.
- `OPEN`: requests fail fast with `NeutrxCircuitBreakerError`.
- `HALF_OPEN`: limited probe requests decide whether to close the circuit.

```ts
api.on('request:error', event => {
  console.error(event.error.code);
});

console.log(api.getCircuitStatus('https://api.example.com/users'));
```

Use circuit breaking with finite timeouts and retries. Avoid retrying through an open circuit from application code; let the circuit recover through its own timeout.

`circuitBreakerStorage.store` may be sync or async and can share circuit state across workers. Core does not ship Redis or database clients; optional packages or application code provide the store.
