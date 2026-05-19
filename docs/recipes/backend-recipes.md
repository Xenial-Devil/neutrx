# Backend Recipes

## Secure Webhook Fetcher

```ts
const webhooks = neutrx.create({
  security: { profile: 'strict' },
  egressPolicy: { mode: 'webhook-target', allowedPorts: [443] },
  timeout: 5_000,
  maxContentLength: 1_000_000,
});

await webhooks.get(urlFromUser);
```

## Internal API Client

```ts
const internal = neutrx.create({
  baseURL: 'https://billing.internal.example',
  security: { profile: 'standard' },
  egressPolicy: { mode: 'internal-service', allowedHosts: ['billing.internal.example'] },
});
```

## Service Discovery And Load Balancing

```ts
const billing = neutrx.create({
  serviceDiscovery: {
    resolver: [
      { url: 'https://billing-a.internal.example', weight: 2 },
      'https://billing-b.internal.example',
    ],
    strategy: 'round-robin',
  },
  egressPolicy: {
    mode: 'internal-service',
    allowedHosts: ['billing-a.internal.example', 'billing-b.internal.example'],
  },
});

await billing.get('/v1/invoices');
```

Use async resolvers for registry, DNS SRV, or environment-backed endpoint lists. Neutrx still validates the selected endpoint before dispatch.

## OAuth2 Client Credentials

```ts
await api.postUrlEncoded('/oauth/token', {
  grant_type: 'client_credentials',
  client_id: process.env.CLIENT_ID ?? '',
  client_secret: process.env.CLIENT_SECRET ?? '',
});
```

## Idempotent POST Retry

```ts
await api.post('/payments', { amount: 42 }, {
  idempotencyKey: crypto.randomUUID(),
});
```

Use this only when the upstream API treats duplicate keys as one operation.

## mTLS Upstream

```ts
const mtls = neutrx.create({
  baseURL: 'https://payments.example.com',
  security: { profile: 'strict' },
  tls: {
    ca: process.env.PAYMENTS_CA_PEM,
    cert: process.env.PAYMENTS_CLIENT_CERT_PEM,
    key: process.env.PAYMENTS_CLIENT_KEY_PEM,
    servername: 'payments.example.com',
    certificatePins: [{
      hostname: 'payments.example.com',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }],
  },
});
```

## GraphQL Client

```ts
api.use(GraphQLPlugin);
const result = await api.gql?.('/graphql', 'query Viewer { viewer { id } }');
```

## OpenTelemetry-Friendly Client

```ts
const traced = neutrx.create({
  instrumentation: { openTelemetry: true, propagateTraceHeaders: true },
});
```

## Prometheus Endpoint

```ts
server.get('/metrics', (_request, response) => {
  response.type('text/plain').send(api.getMetricsPrometheus());
});
```

## Streaming Download With Size Limit

```ts
const file = await api.download('/export.csv', {
  maxContentLength: 20 * 1024 * 1024,
});
```

## SSRF-Safe URL Preview

```ts
const preview = neutrx.create({
  security: { profile: 'strict' },
  egressPolicy: { mode: 'webhook-target', allowedPorts: [443] },
  maxContentLength: 500_000,
});

const response = await preview.get(userUrl, { responseType: 'text' });
```

## Retry Budget

```ts
const api = neutrx.create({
  resilience: {
    enableRetry: true,
    maxRetries: 3,
    retryBudget: {
      maxRetries: 100,
      windowMs: 60_000,
      scope: 'origin',
      namespace: 'billing-api',
      store: sharedRetryBudgetStore,
    },
    circuitBreakerStorage: {
      store: sharedCircuitStateStore,
      scope: 'origin',
      namespace: 'billing-api',
    },
    adaptiveConcurrency: { enabled: true, initialLimit: 10, minLimit: 2, maxLimit: 50 },
  },
});
```

## Cache Revalidation

```ts
const cached = neutrx.create({
  performance: {
    enableCaching: true,
    cacheStrategy: 'stale-while-revalidate',
    respectCacheHeaders: true,
  },
});
```

Responses with `ETag`, `Last-Modified`, and `stale-if-error` cache directives participate in conditional revalidation and stale fallback behavior.
