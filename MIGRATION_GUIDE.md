# Migration Guide

This guide helps users move to Neutrx from another HTTP client or from legacy request libraries. It focuses on secure Node.js 18+ backend usage rather than one-to-one compatibility.

## Installation

```bash
npm install neutrx
```

Neutrx supports Node.js >=18.

## Creating A Client

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  security: { profile: 'standard' },
});
```

Use one shared client per outbound service when possible.

## Basic GET

```ts
const response = await api.get('/users');
console.log(response.status, response.data);
```

## Basic POST

```ts
const response = await api.post('/users', {
  name: 'Ada Lovelace',
});

console.log(response.data);
```

## Headers

```ts
await api.get('/users', {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  },
});
```

Prefer setting service-wide headers on the client and request-specific headers per call.

## Query Params

```ts
await api.get('/search', {
  params: {
    q: 'security',
    page: 1,
    tags: ['http', 'node'],
  },
});
```

Use `paramsSerializer` when an upstream service needs a custom query format.

## JSON Body

```ts
await api.post('/events', {
  type: 'user.created',
  userId: 'user_123',
});
```

Object bodies are intended for JSON APIs. Set explicit `Content-Type` only when the upstream service requires it.

## Timeouts

```ts
const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 5_000,
  connectTimeout: 2_000,
});

await api.get('/slow-report', { timeout: 15_000 });
```

Move global timeout defaults to client creation, then override per request only when needed.

## Cancellation

```ts
const controller = new AbortController();

setTimeout(() => controller.abort(), 1_000);

await api.get('/long-task', {
  signal: controller.signal,
});
```

Use cancellation for user-aborted work, queue shutdown, and time-bounded background jobs.

## Interceptors

```ts
const requestId = api.interceptors.request.use(config => ({
  ...config,
  headers: {
    ...config.headers,
    'X-Request-Source': 'billing-service',
  },
}));

api.interceptors.response.use(response => response);
api.interceptors.request.eject(requestId);
```

Keep interceptors small. Avoid putting secrets, logging, or retry loops inside interceptors when a built-in option exists.

## Error Handling

```ts
import { NeutrxHTTPError, isNeutrxError } from 'neutrx';

try {
  await api.get('/users');
} catch (error) {
  if (!isNeutrxError(error)) throw error;

  console.error(error.code, error.toJSON());

  if (error instanceof NeutrxHTTPError) {
    console.error(error.status);
  }
}
```

Use `toJSON()` for logs because it redacts sensitive fields.

## Security Profile Selection

Select the strictest profile your service can use:

```ts
const strictClient = neutrx.create({
  security: { profile: 'strict' },
});

const standardClient = neutrx.create({
  security: { profile: 'standard' },
});

const legacyClient = neutrx.create({
  security: { profile: 'legacy' },
});
```

Profile guidance:

- `strict`: untrusted or user-controlled URLs, webhook targets, admin tools, and high-risk outbound traffic.
- `standard`: normal production service-to-service calls.
- `legacy`: temporary bridge for trusted migrations that cannot yet meet stronger defaults.

Move legacy clients toward standard or strict settings after migration.

## Retry Migration

If your previous client used a retry wrapper or custom loop, move that policy into Neutrx resilience settings:

```ts
const api = neutrx.create({
  resilience: {
    enableRetry: true,
    maxRetries: 3,
    retryStrategy: 'exponential',
    retryDelay: 250,
    maxRetryDelay: 5_000,
    retryJitter: true,
    retryMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
  },
});
```

Only retry non-idempotent operations when the upstream API gives a safe idempotency key or equivalent guarantee.

## Cache Migration

If your previous client used a response cache, move safe GET caching into Neutrx performance settings:

```ts
const api = neutrx.create({
  performance: {
    enableCaching: true,
    cacheTTL: 300_000,
    cacheMaxSize: 500,
    respectCacheHeaders: true,
  },
});

const response = await api.get('/catalog');
console.log(response.cached);

api.clearCache();
```

Cache only responses that are safe for your service and tenant model.

## Common Behavior Differences

- Node.js >=18 is required.
- Security profiles may block localhost, private IPs, link-local IPs, and cloud metadata endpoints.
- Strict mode protects against HTTPS downgrade redirects.
- Sensitive headers are stripped across unsafe redirects.
- Request and response body size limits may reject traffic that legacy code accepted.
- Errors are typed and redacted for safer logging.
- Retries are configured through resilience settings.
- GET caching is explicit and should respect upstream cache headers where practical.
- Interceptors are for small request and response transforms, not broad application control flow.
- Neutrx is open-source software licensed under the MIT License.
