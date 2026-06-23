---
title: Config Reference
description: "Explore every Neutrx configuration block for core requests, security, egress, discovery, WebSocket, resilience, performance, and instrumentation."
parent: Reference
nav_order: 2
---

# Config Reference

Neutrx merges config in this order:

1. library defaults from `neutrx.defaults`
2. instance defaults from `neutrx.create()` and later `api.defaults` mutations
3. per-request config

Each later layer overrides matching values from earlier layers. Per-request config always wins, including request headers over matching default headers.

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

`neutrx.defaults` is mutable and merges into later root requests and new instances. Instance config and per-request config override it. Headers are cloned and normalized during merges.

Created clients also expose mutable `api.defaults` for common Axios migration patterns:

```ts
api.defaults.baseURL = 'https://api.example.com';
api.defaults.timeout = 10_000;
api.defaults.headers.common.Authorization = `Bearer ${token}`;
```

Mutable defaults are shared state. Changing `neutrx.defaults` affects later root requests and new instances; changing `api.defaults` affects later requests made through that instance. Prefer per-request config for request-specific values to avoid cross-request state bugs.

Per-request config always wins over `api.defaults`. Live instance defaults are shallow-mutable, with deep mutation intentionally supported for `headers.common` and method header buckets. Set security, resilience, and performance profiles during `neutrx.create()` so the constructed SSRF, redirect, retry, circuit breaker, and cache components stay consistent.

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
  schema: userSchema,
  signal: AbortSignal.timeout(2_000),
  validateStatus: status => status < 500,
  throwHttpErrors: false,
  beforeRedirect(context) {
    context.headers['X-Redirect-Hop'] = '1';
  },
});
```

`cancelToken` accepts `CancelToken.source().token` as an Axios migration bridge. Prefer `signal` for new code.

Headers accept both plain objects and `NeutrxHeaders`:

```ts
await api.get('/plain', {
  headers: { Authorization: 'Bearer token' },
});

await api.get('/class', {
  headers: new NeutrxHeaders({ Authorization: 'Bearer token' }),
});
```

At request start, Neutrx clones either input style into an internal `NeutrxHeaders` instance. Request hooks, interceptors, and adapters therefore receive the same case-insensitive header API without mutating the caller-owned input. Set a request header value to `false` to suppress a default and block automatic overwrites without emitting that header; use `NeutrxHeaders.set(name, null)` to delete it outright.

`schema` validates parsed response data with a dependency-free adapter for Zod-like `safeParse`, `parse`, `validate`, TypeBox-style `Check/Errors`, or function validators. Valid schemas may return transformed data, which replaces `response.data`. Invalid data throws `NeutrxValidationError` with normalized `issues`. Set `schema: false` to disable a client default schema for a single request.

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
- `maxRate`: Node HTTP bandwidth cap in bytes per second for both directions, or `[uploadBytesPerSecond, downloadBytesPerSecond]`. Use `0` for either tuple entry to leave that direction uncapped.
- `tls`: CA, client cert/key, SNI, and SHA-256 certificate pins.
- `httpAgent`, `httpsAgent`, and `lookup`: Node transport customization.

`security.rateLimit` is request rate limiting: it counts requests per window and can be scoped per domain. `maxRate` is bandwidth rate limiting: it paces request and response bytes in the Node HTTP adapter and is reflected in upload/download progress `rate` samples.

## WebSocket

```ts
const socket = await api.ws('/events', {
  headers: { Authorization: `Bearer ${token}` },
  params: { tenant: 'acme' },
  reconnect: { attempts: 5, delay: 500, backoff: 'exponential', maxDelay: 30_000 },
});
```

WebSocket options reuse request-like fields: `headers`, `auth`, `params`, `paramsSerializer`, `baseURL`, `allowAbsoluteUrls`, `timeout`, `connectTimeout`, `signal`, and `serviceDiscovery`. Neutrx also runs plugin `beforeRequest` hooks and request interceptors before opening the connection.

Reconnect is disabled by default. `reconnect: true` uses bounded exponential defaults; an object can set `attempts`, `delay`, `backoff`, and `maxDelay`. `minDelay` and `factor` are accepted compatibility aliases, but docs and examples use `delay` and `backoff`.

Node sends prepared headers in the HTTP upgrade request. Browser runtimes use native `WebSocket`, which does not permit custom handshake headers.

## Axios-Compatible And Neutrx-Specific Options

Axios-compatible options supported by Neutrx include `baseURL`, `allowAbsoluteUrls`, `url`, `method`, `headers`, `auth`, `params`, `paramsSerializer`, `data`, `timeout`, `maxRedirects`, `maxContentLength`, `maxBodyLength`, `responseType`, `responseEncoding`, `validateStatus`, `transformRequest`, `transformResponse`, `adapter`, `beforeRedirect`, `decompress`, `withCredentials`, `xsrfCookieName`, `xsrfHeaderName`, `onUploadProgress`, `onDownloadProgress`, `cancelToken`, and `transitional.clarifyTimeoutError`.

Neutrx-specific options are focused on secure backend service-to-service HTTP: `connectTimeout`, `throwHttpErrors`, `parseJson`, `stringifyJson`, `schema`, `idempotencyKey`, `idempotencyKeyHeader`, `httpVersion`, `http2Options`, `serviceDiscovery`, `proxy`, `tls`, `httpAgent`, `httpsAgent`, `lookup`, `socketPath`, `maxRate`, `security`, `egressPolicy`, `resilience`, `performance`, `instrumentation`, `validation`, `skipOAuth`, `cache`, and `followRedirects`.

Some compatible options have backend-first semantics. Redirects are followed by Neutrx so SSRF, downgrade, and credential-stripping policy stays in force; custom adapters should return redirect responses rather than following them internally. `decompress`, agents, lookup, sockets, TLS, and `responseEncoding` are Node transport controls and are unavailable or platform-limited in browsers.

For Docker sockets, local proxies, `allowAbsoluteUrls: false` egress gateways, timeout diagnostics, and bandwidth shaping examples, see [node-infrastructure.md](node-infrastructure.md).

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
httpVersion: 2,
http2Options: {
  sessionTimeout: 60_000,
  maxSessions: 50,
  maxConcurrentStreams: 100,
}
```

`httpVersion: 2` selects the Node `node:http2` adapter. `adapter: 'http2'` is equivalent when you want explicit adapter selection. Sessions are reused by origin and compatible TLS settings until they are closed, receive GOAWAY, exceed `maxSessions`, or sit idle longer than `sessionTimeout`. `maxConcurrentStreams` applies a local cap on active streams per session in addition to the server's advertised remote setting.

HTTP/2 limitations are intentionally explicit: the adapter does not support `proxy`, `socketPath`, `httpAgent`, `httpsAgent`, or `maxRate`. It does not silently fall back to HTTP/1.1 if the server rejects HTTP/2 or TLS ALPN does not negotiate it; use `adapter: 'http'` or `httpVersion: 1` for HTTP/1.1. Plaintext h2c (`http://`) is supported only when your security profile and egress policy allow HTTP.

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

### Distributed State (`StateAdapter`)

`StateAdapter<T>` is a single generic key/value contract (`get`, `set(key, value, ttlMs?)`, optional `delete`/`keys`/`clear`) that one backend implements once and bridges into multiple components. Instead of writing a separate store per collaborator, implement `StateAdapter` (e.g. over Redis) and adapt it:

```ts
import {
  MemoryStateAdapter,
  namespaceAdapter,
  circuitStoreFromAdapter,
  rateLimitStoreFromAdapter,
} from 'neutrx';

const shared = new MemoryStateAdapter(); // or a Redis-backed StateAdapter (optional peer dep)

const api = neutrx.create({
  resilience: {
    circuitBreakerStorage: { store: circuitStoreFromAdapter(shared) },
  },
  security: {
    rateLimit: { enabled: true, storage: { store: rateLimitStoreFromAdapter(shared) } },
  },
});
```

`MemoryStateAdapter` is the in-process reference impl (Map-backed, TTL-aware, single-process only — use a distributed adapter for multi-instance fleets). `namespaceAdapter(adapter, prefix)` prefixes keys so one backend hosts multiple logical namespaces without collision. Bridged stores are **best-effort and non-atomic**, matching the underlying rate-limiter and circuit-breaker contracts. `ttlMs` is an expiry hint only — backends may ignore it; correctness never depends on it, since the in-process layer revalidates timestamps. Concrete distributed backends (Redis, Memcached) ship as opt-in peer deps; core only defines the interface.

#### Redis (`RedisStateAdapter`, Node only)

`RedisStateAdapter` is a ready-made distributed adapter. It adds **no runtime dependency** — you supply your own connected `ioredis` / `node-redis` (or any client matching the `RedisLikeClient` shape: `get`/`set`/`pexpire`/`del`/`keys`). Neutrx imports no Redis package.

```ts
import Redis from 'ioredis';
import { RedisStateAdapter, circuitStoreFromAdapter, rateLimitStoreFromAdapter } from 'neutrx';

const shared = new RedisStateAdapter({ client: new Redis(process.env.REDIS_URL), keyPrefix: 'neutrx:' });

const api = neutrx.create({
  resilience: { circuitBreakerStorage: { store: circuitStoreFromAdapter(shared) } },
  security: { rateLimit: { enabled: true, storage: { store: rateLimitStoreFromAdapter(shared) } } },
});
```

Values are JSON-serialized under `keyPrefix` (default `neutrx:`); `ttlMs` maps to `PEXPIRE`. **Server-only and not atomic** — `set` + `pexpire` are two round-trips and the bridged contracts are best-effort, so concurrent writers can race (correctness never depends on it). **`keys()` / `clear()` use `KEYS prefix*`** — O(N) and blocking on large databases; they scope strictly to `keyPrefix` (so `clear()` never wipes foreign keys or the whole DB), but for hot paths prefer a dedicated namespace DB or a backend that doesn't enumerate. Override `serialize`/`deserialize` for custom encoding.

## Performance

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
  cacheAdapter: myProcessLocalCacheStore,
}
```

`deduplicateRequests` defaults to `true` and shares identical inflight `GET`/`HEAD` dispatches. Set it to `false` to disable deduplication. The default key uses the method, final URL with serialized params, response type, adapter, socket path, and selected headers (`deduplicateHeaders`). Use `deduplicateRequestKey` for service-specific keys. Methods other than `GET` and `HEAD` remain excluded unless explicitly added with `deduplicateMethods`; include an application-safe discriminator such as an idempotency key in the custom key. Dedup hits are counted at `api.getMetrics().requests.deduplicated` and `neutrx_deduplication_hits_total`.

`cacheStrategy` supports `max-age`, `swr`, and `network-first`. `swr` returns stale cache hits until `cacheStaleMax` while one background refresh updates the entry. Stale hits are marked with `response.cached = true`, `response.stale = true`, and `x-cache: STALE`.

`revalidateAfter` lets SWR mark an entry stale before its max-age window ends. When it is omitted, `cacheTTL` or upstream `Cache-Control: max-age` controls freshness. `onRevalidate` runs after a background refresh succeeds, fails, or is skipped because another refresh already owns the same cache key.

When upstream cache headers include `ETag`, `Last-Modified`, or `stale-if-error`, Neutrx sends conditional revalidation headers and can return stale cached data during an upstream error.

`cacheAdapter` must implement `get`, `set`, `delete`, `clear`, `keys`, and may implement `lock`/`unlock` for one-refresh-per-key stale revalidation. Keep networked cache clients in optional packages so core stays dependency-free.

## Instrumentation

```ts
instrumentation: {
  openTelemetry: true,
  tracerName: 'neutrx',
  propagateTraceHeaders: true,
  overwriteTraceHeaders: false,
  recordRequestBodySize: false,
  recordResponseBodySize: false,
}
```

OpenTelemetry attributes use HTTP client semantic names where safe and avoid raw query strings. Body size attributes are opt-in and only use known sizes from `Content-Length` or already-buffered/string payloads.

`propagateTraceHeaders` lets the optional OpenTelemetry bridge inject carrier headers. Existing trace headers are respected by default; set `overwriteTraceHeaders: true` to replace them with the active OpenTelemetry context.

For dependency-free generated propagation headers, use `TraceContextPlugin` or `createTraceContextPlugin({ formats: ['w3c', 'b3-multi', 'b3-single'] })`.
