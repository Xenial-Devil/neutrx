# Config Reference

Neutrx config precedence is:

1. library defaults
2. instance defaults from `neutrx.create()`
3. per-request config

## Core

```ts
const api = neutrx.create({
  baseURL: 'https://api.example.com',
  allowAbsoluteUrls: true,
  timeout: 10_000,
  connectTimeout: 2_000,
  maxRedirects: 5,
  maxContentLength: 52_428_800,
  maxBodyLength: 10_485_760,
  responseEncoding: 'utf8',
  maxRate: [64 * 1024, 256 * 1024],
  auth: { username: 'service', password: process.env.API_PASSWORD ?? '' },
  idempotencyKeyHeader: 'Idempotency-Key',
  parseJson: text => JSON.parse(text),
  stringifyJson: value => JSON.stringify(value),
  throwHttpErrors: true,
  beforeRedirect(context) {
    console.log(context.statusCode, context.toURL);
  },
  transitional: { clarifyTimeoutError: true },
});
```

`legacy` keeps request body size unlimited unless you set `maxBodyLength`. `strict` and `standard` use a finite default.

`allowAbsoluteUrls` defaults to `true`, matching Axios: absolute request URLs replace `baseURL`. Set it to `false` when you want even absolute-looking request URLs to be appended to `baseURL` or a service-discovery endpoint.

`responseEncoding` defaults to `utf8` for buffered text and JSON responses. It is Node-oriented; browser runtimes use platform `TextDecoder` support.

`transitional.clarifyTimeoutError` mirrors Axios. By default, request timeouts use `ECONNABORTED` for Axios migration compatibility. When set to `true`, Neutrx uses `ETIMEDOUT` while still exposing typed timeout errors with a `phase`.

`neutrx.defaults` is mutable and merges into new root requests and new instances. Instance config and per-request config override it. Headers are cloned and normalized during merges.

Created clients also expose mutable `api.defaults` for common Axios migration patterns:

```ts
api.defaults.baseURL = 'https://api.example.com';
api.defaults.timeout = 10_000;
api.defaults.headers.common.Authorization = `Bearer ${token}`;
```

Per-request config still wins over `api.defaults`. Live instance defaults are shallow-mutable, with deep mutation intentionally supported for `headers.common` and method header buckets. Set security, resilience, and performance profiles during `neutrx.create()` so the constructed SSRF, redirect, retry, circuit breaker, and cache components stay consistent.

## Security

```ts
security: {
  profile: 'standard',
  allowedHosts: ['api.example.com', '*.trusted.example'],
  deniedHosts: ['metadata.google.internal'],
  enforceHTTPS: true,
  enableSSRFProtection: true,
  blockPrivateIPs: true,
  blockMetadataIPs: true,
}
```

Use `strict`, `standard`, or `legacy`. Deprecated aliases are accepted for migration only.

## Egress Policy

```ts
egressPolicy: {
  mode: 'webhook-target',
  allowedProtocols: ['https'],
  allowedHosts: ['api.example.com'],
  deniedHosts: ['metadata.google.internal'],
  allowedCidrs: ['203.0.113.0/24'],
  deniedCidrs: ['169.254.0.0/16'],
  allowedPorts: [443],
  requireHttps: true,
  allowRedirectsTo: ['api.example.com'],
  blockCloudMetadata: true,
  requirePublicDns: true,
  allowedSni: ['api.example.com'],
}
```

Presets are `public-api`, `internal-service`, `webhook-target`, and `legacy-migration`. `egressPolicy` is an additional policy layer; use [secure-egress.md](secure-egress.md) for examples.

## Service Discovery

```ts
serviceDiscovery: {
  resolver: [
    { url: 'https://billing-a.internal.example', weight: 2, metadata: { zone: 'a' } },
    'https://billing-b.internal.example',
  ],
  strategy: 'round-robin',
  maxEndpoints: 20,
}
```

`resolver` may be a static endpoint list or an async function that returns endpoints per request. Supported strategies are `round-robin`, `random`, and `sticky-origin`. Service discovery only rewrites relative URLs, then normal SSRF, redirect, TLS, and egress policy validation still applies to the selected endpoint.

## Request

```ts
await api.get('/users', {
  params: { page: 1 },
  paramsSerializer: { indexes: false },
  auth: { username: 'request-user', password: 'request-pass' },
  idempotencyKey: 'request-1',
  signal: AbortSignal.timeout(2_000),
  validateStatus: status => status < 500,
  throwHttpErrors: false,
  beforeRedirect(context) {
    context.headers['X-Redirect-Hop'] = '1';
  },
});
```

`cancelToken` accepts `CancelToken.source().token` as an Axios migration bridge. Prefer `signal` for new code.

Headers merge case-insensitively through `NeutrxHeaders`. Set a request header value to `false` to suppress a default and block automatic overwrites without emitting that header; use `NeutrxHeaders.set(name, null)` to delete it outright.

`validation` is used by `ValidationPlugin`:

```ts
await api.post('/users', { name: 'Ada' }, {
  validation: {
    request: body => body && typeof body === 'object' ? true : [{ message: 'body is required' }],
    response: {
      safeParse(value) {
        return value && typeof value === 'object' && 'id' in value
          ? { success: true, data: value }
          : { success: false, issues: [{ path: ['id'], message: 'id is required' }] };
      },
    },
  },
});
```

Node-only request fields:

- `socketPath`: absolute Unix domain socket path for HTTP requests. It cannot be combined with proxy config and only supports HTTP. The URL host is used as the HTTP `Host` header, not as a DNS or TCP target.
- `decompress`: defaults to `true`; set `false` to keep gzip/deflate/br bytes compressed.
- `maxRate`: bytes per second for both directions, or `[uploadBytesPerSec, downloadBytesPerSec]`.
- `tls`: CA, client cert/key, SNI, and SHA-256 certificate pins.
- `httpAgent`, `httpsAgent`, and `lookup`: Node transport customization.

## Axios-Compatible And Neutrx-Specific Options

Axios-compatible options supported by Neutrx include `baseURL`, `allowAbsoluteUrls`, `url`, `method`, `headers`, `auth`, `params`, `paramsSerializer`, `data`, `timeout`, `maxRedirects`, `maxContentLength`, `maxBodyLength`, `responseType`, `responseEncoding`, `validateStatus`, `transformRequest`, `transformResponse`, `adapter`, `beforeRedirect`, `decompress`, `withCredentials`, `xsrfCookieName`, `xsrfHeaderName`, `onUploadProgress`, `onDownloadProgress`, `cancelToken`, and `transitional.clarifyTimeoutError`.

Neutrx-specific options are focused on secure backend service-to-service HTTP: `connectTimeout`, `throwHttpErrors`, `parseJson`, `stringifyJson`, `idempotencyKey`, `idempotencyKeyHeader`, `httpVersion`, `http2Options`, `serviceDiscovery`, `proxy`, `tls`, `httpAgent`, `httpsAgent`, `lookup`, `socketPath`, `maxRate`, `security`, `egressPolicy`, `resilience`, `performance`, `instrumentation`, `validation`, `skipOAuth`, `cache`, and `followRedirects`.

Some compatible options have backend-first semantics. Redirects are followed by Neutrx so SSRF, downgrade, and credential-stripping policy stays in force; custom adapters should return redirect responses rather than following them internally. `decompress`, agents, lookup, sockets, TLS, and `responseEncoding` are Node transport controls and are unavailable or platform-limited in browsers.

Docker Engine over the default Unix socket:

```ts
const docker = neutrx.create({
  baseURL: 'http://docker',
  socketPath: '/var/run/docker.sock',
  proxy: false,
});

const version = await docker.get('/v1/version');
```

For `socketPath`, Neutrx validates the local socket path and skips DNS, SSRF, private-IP, HTTPS, and egress-policy network checks for the synthetic URL host. Treat `socketPath` as trusted local configuration and never derive it from user-controlled input.

`idempotencyKey` sets the `Idempotency-Key` header. For `POST` and `PATCH`, it also marks the request as retryable when the error/status is otherwise retryable.

TLS/mTLS example:

```ts
tls: {
  ca: process.env.UPSTREAM_CA_PEM,
  cert: process.env.CLIENT_CERT_PEM,
  key: process.env.CLIENT_KEY_PEM,
  servername: 'api.example.com',
  certificatePins: [{
    hostname: 'api.example.com',
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    expiresAt: '2026-12-31T00:00:00.000Z',
  }],
}
```

Adapter fields:

- `adapter: 'http'`: Node HTTP/HTTPS adapter.
- `adapter: 'fetch'`: native `globalThis.fetch`.
- `adapter: 'http2'`: HTTP/2 adapter.
- `adapter: (config: NeutrxRequestConfig) => RawHttpResponse`: custom adapter.

Adapters are transport functions only. Neutrx runs request/response interceptors, retries, circuit breaker, cache, metrics, parsing, redaction, and redirect policy around the selected adapter, so instance-level and per-request adapter swaps do not change user request code.

HTTP/2 options:

```ts
http2Options: {
  sessionTimeout: 60_000,
  maxSessions: 50,
  maxConcurrentStreams: 100,
}
```

## Resilience

```ts
resilience: {
  enableRetry: true,
  maxRetries: 3,
  retryMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
  retryBudget: {
    maxRetries: 100,
    windowMs: 60_000,
    scope: 'origin',
    namespace: 'billing-api',
    store: sharedRetryBudgetStore,
  },
  enableCircuitBreaker: true,
  failureThreshold: 5,
  circuitBreakerStorage: {
    store: sharedCircuitStateStore,
    scope: 'origin',
    namespace: 'billing-api',
  },
  enableBulkhead: true,
  maxConcurrent: 10,
  adaptiveConcurrency: {
    enabled: true,
    initialLimit: 10,
    minLimit: 2,
    maxLimit: 50,
    targetLatency: 500,
  },
}
```

`retryBudget.store` and `circuitBreakerStorage.store` are dependency-free interfaces for shared fleet state. Use them from optional Redis/database packages or userland code; core only calls the interface.

## Performance

```ts
performance: {
  enableCaching: true,
  deduplicateRequests: true,
  cacheStrategy: 'stale-while-revalidate',
  cacheTTL: 300_000,
  cacheStaleMax: 1_500_000,
  cacheMaxSize: 500,
  respectCacheHeaders: true,
  cacheAdapter: myProcessLocalCacheStore,
}
```

`deduplicateRequests` shares identical inflight `GET`/`HEAD` dispatches. `stale-while-revalidate` returns stale cache hits until `cacheStaleMax` while one background refresh updates the entry.

When upstream cache headers include `ETag`, `Last-Modified`, or `stale-if-error`, Neutrx sends conditional revalidation headers and can return stale cached data during an upstream error.

`cacheAdapter` must implement `get`, `set`, `delete`, `clear`, `keys`, and may implement `lock`/`unlock` for one-refresh-per-key stale revalidation. Keep networked cache clients in optional packages so core stays dependency-free.

## Instrumentation

```ts
instrumentation: {
  openTelemetry: true,
  tracerName: 'neutrx',
  propagateTraceHeaders: true,
  recordRequestBodySize: false,
  recordResponseBodySize: false,
}
```

OpenTelemetry attributes use HTTP client semantic names where safe and avoid raw query strings. Body size attributes are opt-in and only use known sizes from `Content-Length` or already-buffered/string payloads.
