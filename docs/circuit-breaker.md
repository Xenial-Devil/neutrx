# Circuit Breaker

Circuit breaking is enabled by default and tracked per target host.

```ts
const api = neutrx.create({
  resilience: {
    enableCircuitBreaker: true,
    failureThreshold: 5,
    successThreshold: 2,
    circuitTimeout: 30_000,
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
