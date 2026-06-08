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
- `ws(url, options?)`
- `getUri(config)`
- `clearCache(pattern?)`
- `invalidateCache(pattern?)`
- `deleteCacheEntry(configOrUrl)`

## Utility Methods

`getUri(config)` builds the final request URL without dispatching. It applies `baseURL`, `allowAbsoluteUrls`, `params`, and `paramsSerializer`, and it preserves existing query strings and hash fragments:

```ts
api.getUri({ url: '/users?active=true#team', params: { page: 2 } });
// "/users?active=true&page=2#team" or with baseURL, "https://api.example.com/users?active=true&page=2#team"
```

`isNeutrxError(error)` and `neutrx.isNeutrxError(error)` narrow errors to Neutrx's branded error classes. `isCancel(error)` and `neutrx.isCancel(error)` detect the `CancelToken` migration bridge.

`clearCache()` removes all cached responses, `invalidateCache(pattern)` removes cached entries whose internal key or final URL matches a string or regular expression, and `deleteCacheEntry(configOrUrl)` removes the entry for a specific final URL.

`postForm()`, `putForm()`, and `patchForm()` are multipart form helpers. In Node, plain objects are serialized as multipart bodies by the Node HTTP adapter. In browser and browser-like runtimes, plain objects are converted to `FormData` where the platform provides it.

## Request Config

Important fields:

- `baseURL`
- `allowAbsoluteUrls`
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
- `responseEncoding`
- `validateStatus`
- `throwHttpErrors`
- `parseJson`
- `stringifyJson`
- `transformRequest`
- `transformResponse`
- `schema`
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
- `beforeRedirect`
- `decompress` (Node only)
- `maxRate` (Node only, bytes per second or `[upload, download]`)
- `transitional.clarifyTimeoutError`
- `security`
- `egressPolicy`
- `resilience`
- `performance`
- `instrumentation`
- `validation`
- `onUploadProgress`
- `onDownloadProgress`

Progress events include `loaded`, `total`, `percent`, `progress`, `bytes`, `rate`, `estimated`, and `upload` or `download`.

```ts
import type { ProgressEvent } from 'neutrx';

function renderProgress(event: ProgressEvent) {
  const percent = event.percent === undefined ? 'unknown' : `${event.percent.toFixed(1)}%`;
  const eta = event.estimated === undefined ? 'unknown' : `${event.estimated.toFixed(1)}s`;
  console.log(`${percent} complete, +${event.bytes} bytes, ${event.rate} B/s, eta ${eta}`);
}

await api.get('/exports/monthly.csv', {
  responseType: 'buffer',
  onDownloadProgress: renderProgress,
});
```

`bytes` is the delta since the previous event for that request direction. `rate` is bytes per second from the previous event. `estimated` is only present when Neutrx knows `total` and has a positive rate. Node HTTP can measure buffered bodies, Node streams, buffered responses, and response streams as callers consume them. Fetch-based adapters depend on platform `ReadableStream` support. Browser `FormData`, opaque platform-managed request bodies, missing `Content-Length`, and runtimes without readable response streams may only produce a final event or omit `total`, `percent`, and `estimated`.

`security.rateLimit` limits request count over time. `maxRate` limits Node HTTP upload/download bandwidth over time; pass `[uploadBytesPerSecond, downloadBytesPerSecond]` and use `0` for an uncapped direction.

Adapters can be selected with `adapter: 'http'`, `adapter: 'fetch'`, `adapter: 'http2'`, constants such as `HttpAdapter`, or a custom `NeutrxAdapter` function. Node uses HTTP by default; browser-like runtimes use fetch.

Axios-compatible migration options include `allowAbsoluteUrls`, `beforeRedirect`, `decompress`, `responseEncoding`, and `transitional.clarifyTimeoutError`. `allowAbsoluteUrls: false` forces absolute-looking request URLs through `baseURL`; `beforeRedirect` runs after Neutrx validates and prepares the next redirect hop; `decompress: false` preserves compressed bytes; `responseEncoding` controls buffered text decoding; `transitional.clarifyTimeoutError: true` switches timeout error codes from `ECONNABORTED` to `ETIMEDOUT`.

Neutrx-specific options include backend safety and resilience controls such as `security`, `egressPolicy`, `resilience`, `performance`, `instrumentation`, `serviceDiscovery`, `tls`, `socketPath`, `maxRate`, `schema`, `validation`, and `idempotencyKey`.

Custom adapters receive the fully prepared `NeutrxRequestConfig` and return a `RawHttpResponse`. Interceptors, retries, circuit breaker, cache, metrics, response parsing, and redirect policy stay in the client lifecycle outside the adapter.

Responses include `request` when the adapter can expose a safe transport reference: Node HTTP returns `ClientRequest`, fetch returns `Request` where possible.

Use `createSecureAdapter()` for custom adapters that should reject URL mutation and redirect responses outside Neutrx redirect policy.

`idempotencyKey` sets `Idempotency-Key`. It also allows retrying `POST` and `PATCH` when retry policy says the failure is retryable.

## Response Schema Validation

`schema` validates parsed and transformed response data before a successful response is returned. Validators may be Zod-like `safeParse`, `parse`, `validate`, TypeBox-style `Check/Errors`, or function validators. Successful schemas can return parsed data, which replaces `response.data`; failures throw `NeutrxValidationError` with normalized `issues`.

```ts
const userSchema = {
  parse(value: unknown) {
    if (value && typeof value === 'object' && 'id' in value) {
      return value as { readonly id: string };
    }
    throw Object.assign(new Error('invalid user'), {
      issues: [{ path: ['id'], message: 'id is required' }],
    });
  },
};

const response = await api.get('/users/1', { schema: userSchema });
response.data.id;

await api.get('/users/1', { schema: false }); // disables a client default schema
```

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
  deduplicateRequestKey: config => `${config.method}:${config.url}:${config.headers.get('X-Tenant-ID') ?? ''}`,
  deduplicateMethods: ['GET', 'HEAD'],
  deduplicateHeaders: ['accept', 'authorization', 'range'],
  cacheStrategy: 'swr',
  cacheTTL: 300_000,
  revalidateAfter: 60_000,
  cacheStaleMax: 1_500_000,
  cacheMaxSize: 500,
  respectCacheHeaders: true,
  onRevalidate: event => console.log(event.url, event.updated),
  cacheAdapter,
}
```

Cache strategies are `max-age`, `swr`, and `network-first`. SWR marks stale hits with `response.cached = true` and `response.stale = true`, returns them immediately, and refreshes the entry in the background. `ttl` and `stale-while-revalidate` remain compatibility aliases.

Request deduplication defaults to enabled for identical inflight `GET` and `HEAD` requests only. Set `deduplicateRequests: false` to disable it. Other methods require explicit `deduplicateMethods` opt-in and an application-safe custom key.

## HTTP/2

Use `httpVersion: 2` or `adapter: 'http2'` to send requests through Node's `node:http2` transport:

```ts
const api = neutrx.create({
  baseURL: 'https://api.example.com',
  httpVersion: 2,
  http2Options: {
    sessionTimeout: 60_000,
    maxSessions: 50,
    maxConcurrentStreams: 100,
  },
});
```

HTTP/2 sessions are reused by origin and compatible TLS settings. `http2Options.sessionTimeout` closes idle sessions, `maxSessions` bounds the shared session pool, and `maxConcurrentStreams` caps active streams per session alongside the server's remote setting. `getHttp2SessionStats()` reports active streams, session count, closed/destroyed flags, and remote stream limits. GOAWAY closes the affected session so the next request opens a fresh one.

The HTTP/2 adapter preserves Neutrx redirect handling and supports buffered and stream upload/download progress when byte counts are available. It does not support proxies, Unix `socketPath`, custom HTTP agents, or `maxRate`, and it does not silently fall back to HTTP/1.1 when HTTP/2 negotiation fails. Select `adapter: 'http'` or `httpVersion: 1` for HTTP/1.1 behavior.

## WebSocket

```ts
const socket = await api.ws<{ type: string }>('/realtime', {
  headers: { Authorization: 'Bearer service-token' },
  reconnect: { attempts: 3, delay: 500, backoff: 'exponential', maxDelay: 10_000 },
  parseMessage: data => JSON.parse(String(data)) as { type: string },
  onMessage: message => console.log(message.type),
});

socket.send('hello');
socket.close();
```

`api.ws()` prepares a `GET` upgrade request through the same client defaults as HTTP calls: `baseURL`, params, default headers, basic auth, service discovery, plugin `beforeRequest` hooks, and request interceptors run before the connection is opened. `http:` and `https:` URLs are converted to `ws:` and `wss:` for the actual WebSocket target.

Node performs the upgrade directly and sends prepared headers, including `Authorization`, during the handshake. Browser builds use native `WebSocket`; browsers do not expose custom handshake headers, so header mutations are available to hooks/interceptors but cannot be sent by the platform constructor.

Reconnect is opt-in. Use `reconnect: true` for bounded exponential reconnect defaults, or pass `{ attempts, delay, backoff, maxDelay }`. `backoff` may be `fixed`, `linear`, `exponential`, or a function that receives the one-based reconnect attempt.

## Interceptors

```ts
const id = api.interceptors.request.use(
  config => config,
  undefined,
  {
    synchronous: true,
    runWhen: config => config.method === 'GET',
  }
);
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
- `WebSocketPlugin`
- `LogPlugin`
- `OtelPlugin`
- `TraceContextPlugin`

`ValidationPlugin` reads `config.validation.request` before dispatch and `config.validation.response` after parsing. Use the first-class `schema` option for normal response validation; use the plugin when request-body validation or central plugin hooks are needed. Validators may be functions or schema-like objects with `safeParse`, `parse`, `validate`, or TypeBox-style `Check`/`Errors`. Failures throw `NeutrxValidationError`.

`WebSocketPlugin` is retained as a compatibility plugin; `api.ws(url, options)` is available directly on clients.

`LogPlugin` writes structured request success and error entries to any logger installed with `api.setLogger(logger)`. Success URLs omit query strings; error entries use the redacted `toStructuredError()` representation.

`OtelPlugin` enables the built-in OpenTelemetry bridge through `api.use(OtelPlugin)` without adding a runtime dependency to Neutrx. It creates a client span, propagates that span's context, records retry-attempt events, and attaches safe HTTP and Neutrx attributes.

`TraceContextPlugin` provides dependency-free W3C Trace Context and B3 propagation. The resolved identity is available on `response.traceContext` and typed errors.

## Headers

Request and client configs accept either a plain header object or `NeutrxHeaders`. Neutrx converts both to an internal `NeutrxHeaders` instance at request start, before request hooks and interceptors run.

```ts
await api.get('/plain', {
  headers: { Authorization: 'Bearer secret' },
});

const headers = new NeutrxHeaders({ Authorization: 'Bearer secret' });
headers.setContentType('application/json');
headers.setAuthorization(false);
headers.setUserAgent('billing-service/1.0');
headers.normalize();
for (const [name, value] of headers) console.log(name, value);
headers.redactSensitive();

await api.get('/class', { headers });
```

Header names are case-insensitive. Calling `set(name, false)` stores a non-emitted sentinel that blocks automatic overwrites such as inferred `Content-Type`; calling `set(name, null)` deletes the header.

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

Typed errors expose a stable `category`, request and trace identity, retryability, and a redacted `toJSON()` representation. `toStructuredError(error)` safely normalizes non-Neutrx errors for structured logging.
