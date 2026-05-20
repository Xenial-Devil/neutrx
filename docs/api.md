# Neutrx API Reference

## Import

```ts
import neutrx, {
  HttpAdapter,
  NeutrxError,
  NeutrxHTTPError,
  NeutrxHeaders,
  isNeutrxError,
} from 'neutrx';
```

## Client Creation

```ts
const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 30_000,
  connectTimeout: 10_000,
});
```

The default export is callable:

```ts
await neutrx('https://api.example.com/health');
await neutrx({ url: 'https://api.example.com/health', method: 'GET' });
```

CommonJS:

```js
const { default: neutrx, isNeutrxError } = require('neutrx');
```

Global defaults:

```ts
neutrx.defaults.baseURL = 'https://api.example.com';
neutrx.defaults.headers = { 'X-Service': 'billing' };
```

## Methods

- `request(config)`
- `get(url, config?)`
- `post(url, data, config?)`
- `put(url, data, config?)`
- `patch(url, data, config?)`
- `delete(url, config?)`
- `head(url, config?)`
- `options(url, config?)`
- `postForm(url, data, config?)`
- `putForm(url, data, config?)`
- `patchForm(url, data, config?)`
- `postUrlEncoded(url, data, config?)`
- `putUrlEncoded(url, data, config?)`
- `patchUrlEncoded(url, data, config?)`
- `upload(url, data, config?)`
- `download(url, config?)`
- `sse(url, handlers?)`
- `getUri(config)`

## Request Config

Important fields:

- `baseURL`
- `url`
- `method`
- `params`
- `paramsSerializer`
- `headers`
- `auth`
- `idempotencyKey`
- `idempotencyKeyHeader`
- `data`
- `timeout`
- `connectTimeout`
- `signal`
- `cancelToken` (migration bridge; prefer `signal`)
- `maxRedirects`
- `maxContentLength`
- `maxBodyLength`
- `responseType`
- `validateStatus`
- `throwHttpErrors`
- `parseJson`
- `stringifyJson`
- `transformRequest`
- `transformResponse`
- `adapter`
- `fetch`
- `httpVersion`
- `serviceDiscovery`
- `proxy`
- `tls`
- `lookup`
- `httpAgent`
- `httpsAgent`
- `socketPath` (Node only)
- `decompress` (Node only)
- `maxRate` (Node only, bytes per second or `[upload, download]`)
- `security`
- `egressPolicy`
- `resilience`
- `performance`
- `instrumentation`
- `validation`
- `onUploadProgress`
- `onDownloadProgress`

Progress events include `loaded`, `total`, `percent`, `bytes`, `rate`, `estimated`, and `upload` or `download`.

Adapters can be selected with `adapter: 'http'`, `adapter: 'fetch'`, `adapter: 'http2'`, constants such as `HttpAdapter`, or a custom adapter function. Node uses HTTP by default; browser-like runtimes use fetch.

Responses include `request` when the adapter can expose a safe transport reference: Node HTTP returns `ClientRequest`, fetch returns `Request` where possible.

Use `createSecureAdapter()` for custom adapters that should reject URL mutation and redirect responses outside Neutrx redirect policy.

`idempotencyKey` sets `Idempotency-Key`. It also allows retrying `POST` and `PATCH` when retry policy says the failure is retryable.

## Service Discovery

```ts
const api = neutrx.create({
  serviceDiscovery: {
    resolver: ['https://api-a.internal.example', 'https://api-b.internal.example'],
    strategy: 'round-robin',
  },
});

await api.get('/health');
```

Resolvers can be static arrays or async functions. Discovery applies to relative request URLs and the selected endpoint is exposed as `config.serviceEndpoint` for adapters, hooks, and telemetry.

## Security Config

```ts
security: {
  profile: 'strict' | 'standard' | 'legacy',
  allowedHosts: ['api.example.com'],
  deniedHosts: ['*.blocked.example'],
  enforceHTTPS: true,
  enableSSRFProtection: true,
  blockPrivateIPs: true,
  blockMetadataIPs: true,
}
```

## Egress Policy

```ts
egressPolicy: {
  mode: 'webhook-target',
  allowedProtocols: ['https'],
  allowedPorts: [443],
  requirePublicDns: true,
  blockCloudMetadata: true,
}
```

`api.getEgressPolicy()` returns safe policy audit data.

## Resilience Config

```ts
resilience: {
  enableRetry: true,
  maxRetries: 3,
  retryStrategy: 'exponential',
  retryDelay: 250,
  maxRetryDelay: 5000,
  retryJitter: true,
  retryMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
  retryBudget: {
    maxRetries: 100,
    windowMs: 60_000,
    scope: 'origin',
    namespace: 'billing-api',
    store: sharedRetryBudgetStore,
  },
  adaptiveConcurrency: { enabled: true, initialLimit: 10, maxLimit: 50 },
  enableCircuitBreaker: true,
  failureThreshold: 5,
  successThreshold: 2,
  circuitTimeout: 30_000,
  circuitBreakerStorage: {
    store: sharedCircuitStateStore,
    scope: 'origin',
    namespace: 'billing-api',
  },
}
```

Shared stores are interfaces only. Core stays zero-dependency; Redis or database-backed stores belong in optional packages or application code.

## Performance Config

```ts
performance: {
  enableCaching: true,
  deduplicateRequests: true,
  cacheStrategy: 'stale-while-revalidate',
  cacheTTL: 300_000,
  cacheStaleMax: 1_500_000,
  cacheMaxSize: 500,
  respectCacheHeaders: true,
  cacheAdapter,
}
```

## HTTP/2

`http2Options.maxConcurrentStreams` caps active streams per session. `getHttp2SessionStats()` reports active streams, session count, closed/destroyed flags, and remote stream limits. GOAWAY closes the affected session so the next request opens a fresh one.

## Interceptors

```ts
const id = api.interceptors.request.use(config => config);
api.interceptors.request.eject(id);
api.interceptors.request.clear();

api.interceptors.response.use(response => response, error => error);
api.interceptors.response.clear();
```

## Plugins

Built-in plugins:

- `OAuth2Plugin`
- `GraphQLPlugin`
- `MockPlugin`
- `ValidationPlugin`

`ValidationPlugin` reads `config.validation.request` before dispatch and `config.validation.response` after parsing. Validators may be functions or schema-like objects with `safeParse`, `parse`, `validate`, or TypeBox-style `Check`/`Errors`. Failures throw `NeutrxValidationError`.

## Headers

```ts
const headers = new NeutrxHeaders({ Authorization: 'Bearer secret' });
headers.setContentType('application/json');
headers.redactSensitive();
```

## Errors

All Neutrx errors are branded:

```ts
try {
  await api.get('/missing');
} catch (error) {
  if (isNeutrxError(error)) {
    console.error(error.code, error.toJSON());
  }
}
```

HTTP failures throw `NeutrxHTTPError` subclasses unless `validateStatus` accepts the status or `throwHttpErrors: false` is set.
