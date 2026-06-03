# Axios Migration Guide

This guide covers the common Axios backend migration path. Neutrx intentionally keeps familiar request ergonomics, but it does not clone Axios blindly: backend security and resilience behavior stay explicit.

For browser, edge, and shared full-stack clients, see [Full-stack and frontend migration](full-stack-frontend-migration.md).

## Install And Create A Client

```bash
npm install neutrx
```

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  security: { profile: 'standard' },
});
```

## Replace Common Calls

```ts
await api.get('/users', { params: { page: 1 } });
await api.post('/users', { name: 'Ada' });
await api.put('/users/1', { name: 'Ada Lovelace' });
await api.patch('/users/1', { name: 'Ada Byron' });
await api.delete('/users/1');
await api.head('/health');
await api.options('/health');
```

`NeutrxResponse` includes `status`, `statusText`, `headers`, `data`, `config`, `requestId`, `timing`, retry attempts, cache state, and deduplication state.

## Move Defaults

```ts
const api = neutrx.create({ baseURL: 'https://api.example.com' });

api.defaults.baseURL = process.env.API_URL ?? 'https://api.example.com';
api.defaults.timeout = 10_000;
api.defaults.headers.common.Authorization = `Bearer ${token}`;

await api.get('/me', {
  headers: { Authorization: `Bearer ${requestScopedToken}` },
});
```

Per-request config still overrides instance defaults. Configure security, resilience, and performance policies during `neutrx.create()` so constructed SSRF, redirect, retry, circuit breaker, bulkhead, and cache components stay consistent.

## Update Interceptors

```ts
const id = api.interceptors.request.use(config => {
  config.headers.set('X-Service', 'billing');
  return config;
});

api.interceptors.response.use(response => response);
api.interceptors.request.eject(id);
```

Keep interceptors small. Prefer built-in retry, circuit breaker, cache, metrics, and redaction behavior instead of reimplementing those concerns in interceptor code.

## Map Axios Options

| Axios option or pattern | Neutrx mapping | Notes |
| --- | --- | --- |
| `axios.create({ baseURL })` | `neutrx.create({ baseURL })` | Node.js 18+ |
| `axios.get(url, config)` | `api.get(url, config)` | Same verb shape |
| `axios.post(url, data, config)` | `api.post(url, data, config)` | Plain objects become JSON |
| `params` | `params` | Arrays repeat by default |
| `paramsSerializer` | `paramsSerializer` | Function or Axios-style `indexes` object |
| `auth` | `auth` | Basic auth only; bearer tokens belong in headers or `setAuth()` |
| `validateStatus` | `validateStatus` | Used before HTTP errors are thrown |
| `CancelToken` | `AbortController` preferred, `CancelToken` bridge available | New code should use `signal` |
| `onUploadProgress` | `onUploadProgress` | Depends on adapter and body visibility |
| `onDownloadProgress` | `onDownloadProgress` | Depends on stream visibility |
| `adapter` | `adapter: 'http'`, `'fetch'`, `'http2'`, or custom function | Built-in Node HTTP is safest for backend egress |
| `beforeRedirect` | `beforeRedirect` | Runs inside Neutrx redirect policy |
| `decompress` | `decompress` | Node HTTP only |
| `responseEncoding` | `responseEncoding` | Buffered text and JSON decoding |
| `transitional.clarifyTimeoutError` | Same field | Axios-compatible timeout code switch |

For a fuller compatibility matrix, see [Axios migration matrix](axios-migration-matrix.md).

## Convert Cancellation

```ts
const controller = new AbortController();

setTimeout(() => controller.abort(), 1_000);

await api.get('/long-task', {
  signal: controller.signal,
});
```

`CancelToken.source()` exists for migrations, but `AbortController` is the preferred API for new code.

## Convert Form Requests

```ts
await api.postForm('/uploads', {
  name: 'monthly-report',
  file: new Blob(['report data'], { type: 'text/plain' }),
});

await api.postUrlEncoded('/oauth/token', {
  grant_type: 'client_credentials',
  client_id: process.env.CLIENT_ID ?? '',
  client_secret: process.env.CLIENT_SECRET ?? '',
});
```

## Review Security Differences

Neutrx security profiles can block traffic that a generic Axios client may have allowed:

- `strict` and `standard` block localhost, private IPs, link-local IPs, cloud metadata targets, unsafe URL credentials, and unsafe redirect targets.
- Cross-origin redirects strip `Authorization`, `Cookie`, `Proxy-Authorization`, `Host`, and sensitive custom headers.
- Request and response size limits may reject traffic that legacy clients accepted.
- Errors are typed and redacted through `toJSON()`.

For user-controlled URLs, prefer:

```ts
const previews = neutrx.create({
  security: { profile: 'strict' },
  egressPolicy: {
    mode: 'webhook-target',
    allowedProtocols: ['https'],
    allowedPorts: [443],
    requirePublicDns: true,
  },
});

await previews.get(userProvidedUrl);
```

## Add Resilience

```ts
const api = neutrx.create({
  baseURL: 'https://api.example.com',
  resilience: {
    enableRetry: true,
    maxRetries: 3,
    retryDelay: 250,
    maxRetryDelay: 5_000,
    retryJitter: true,
    enableCircuitBreaker: true,
    failureThreshold: 5,
    enableBulkhead: true,
    maxConcurrent: 20,
  },
});
```

Retries default to idempotent methods. Use `idempotencyKey` before retrying `POST` or `PATCH`.

## Final Migration Checklist

- Replace imports with `import neutrx from 'neutrx'`.
- Create one client per upstream service.
- Move service defaults into `neutrx.create()`.
- Set `security.profile` to `standard` or `strict`.
- Replace cancellation with `AbortController`.
- Move retry loops into `resilience`.
- Use `isNeutrxError()` and `error.toJSON()` for logs.
- Verify any `legacy` profile use is temporary and trusted.
