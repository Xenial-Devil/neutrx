<p align="center">
  <img src="docs/assets/neutrx-logo.svg" alt="Neutrx logo" width="520">
</p>

# Neutrx

[![CI](https://github.com/Xenial-Devil/neutrx/actions/workflows/ci.yml/badge.svg)](https://github.com/Xenial-Devil/neutrx/actions/workflows/ci.yml)
[![Codecov](https://codecov.io/gh/Xenial-Devil/neutrx/branch/main/graph/badge.svg)](https://codecov.io/gh/Xenial-Devil/neutrx)
[![npm version](https://img.shields.io/npm/v/neutrx.svg)](https://www.npmjs.com/package/neutrx)
[![GitHub release](https://img.shields.io/github/v/release/Xenial-Devil/neutrx?sort=semver)](https://github.com/Xenial-Devil/neutrx/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![Runtime deps: 0](https://img.shields.io/badge/runtime_deps-0-brightgreen.svg)](package.json)
[![Sponsor](https://img.shields.io/badge/sponsor-GitHub%20Sponsors-fafbfc?logo=githubsponsors)](https://github.com/sponsors/Xenial-Devil)

Neutrx is a security-first TypeScript HTTP client for Node.js backend services, with a browser build for browsers and fetch-compatible edge runtimes. It combines an ergonomic request API with built-in SSRF protection, redirect safety, circuit breaking, bulkhead isolation, retries, metrics, tracing, schema validation, typed redacted errors, and zero required runtime dependencies.

Node.js is the primary runtime and provides Neutrx's strongest security controls. The browser build shares the request API, resilience features, metrics, tracing, and validation behavior where platform fetch APIs allow it, but it cannot provide Node-level network controls.

Full documentation: [https://xenial-devil.github.io/neutrx/](https://xenial-devil.github.io/neutrx/).

## Why Neutrx?

Neutrx is designed for secure service-to-service HTTP and controlled backend egress. Axios is more mature and more general-purpose; Neutrx focuses on making backend security, resilience, and observability available without assembling several runtime dependencies.

| Area | Neutrx posture |
| --- | --- |
| Runtime target | Node.js >=18 backend-first, with a browser build usable in fetch-compatible edge runtimes |
| Dependencies | No required runtime dependencies |
| Security posture | SSRF protection, redirect validation, secret stripping, size limits, typed redacted errors |
| Resilience | Retries, retry budgets, circuit breaking, bulkhead isolation, and adaptive concurrency |
| Observability | Metrics snapshots, Prometheus output, lifecycle events, and optional OpenTelemetry integration |
| Validation | First-class response schemas and a request/response validation plugin |
| Types and modules | Strict TypeScript declarations, ESM, CommonJS, and explicit runtime entry points |

## Installation

```bash
npm install neutrx
```

```bash
pnpm add neutrx
yarn add neutrx
```

Neutrx requires Node.js `>=18.0.0` for backend usage and has no required runtime dependencies.

## Supported Runtimes

| Runtime | Support |
| --- | --- |
| Node.js 18, 20, and 22 | Supported and tested in CI. Node.js `>=18.0.0` is required. |
| Modern browsers | A dedicated `neutrx/browser` build and package `browser` condition use native fetch APIs. |
| Fetch-compatible edge or worker runtimes | Use `neutrx/browser` when the runtime provides the required web APIs; verify behavior in the target platform. |
| Node.js <18 | Unsupported. |

Node.js is the tested, backend-first runtime. Browser and edge runtimes cannot provide Node-level DNS validation, private-IP inspection, certificate pinning, custom CA/mTLS controls, Unix sockets, or raw proxy and agent controls. React Native, Bun, and Deno are not currently claimed as supported runtimes.

## Quick Start

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  security: { profile: 'standard' },
});

const usersResponse = await api.get('/users', { params: { page: 1 } });
const createdResponse = await api.post('/users', { name: 'Ada Lovelace' });
const direct = await neutrx('https://api.example.com/health');

console.log(usersResponse.data, createdResponse.status, direct.status);
```

Create one shared client per upstream service when possible. Put service-wide security, resilience, and timeout policy on the client, then use request config for request-specific values.

## Node Usage

The default Node entry uses the built-in Node HTTP adapter and enables Neutrx's strongest backend security and transport feature set:

```ts
import neutrx from 'neutrx/node';

const billing = neutrx.create({
  baseURL: 'https://billing.example.com',
  timeout: 8_000,
  security: {
    profile: 'standard',
    allowedHosts: ['billing.example.com'],
  },
  resilience: {
    enableRetry: true,
    maxRetries: 3,
    enableCircuitBreaker: true,
    enableBulkhead: true,
    maxConcurrent: 20,
  },
});

const invoices = await billing.get('/v1/invoices');
```

The root `neutrx` import resolves to the Node build in Node.js. Use the explicit `neutrx/node` entry when you want the runtime choice to be visible in shared code. See [Node usage](docs/node-usage.md) and [Node infrastructure](docs/node-infrastructure.md) for HTTP/2, TLS, proxies, Unix sockets, agents, and bandwidth limits.

## Browser Usage

Use the browser entry for frontend and fetch-compatible edge code:

```ts
import neutrx from 'neutrx/browser';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  adapter: 'fetch',
  credentials: 'include',
});

const users = await api.get('/users', {
  signal: AbortSignal.timeout(5_000),
});
```

Browser bundlers can also resolve `import neutrx from 'neutrx'` through the package `browser` condition. Browser and edge builds do not provide Node-level SSRF or DNS-rebinding guarantees; enforce outbound policy on a trusted server boundary. See [Browser usage](docs/browser-usage.md) and [full-stack migration](docs/full-stack-frontend-migration.md).

## CommonJS Usage

CommonJS is supported too. The CommonJS export is callable and exposes the same client factory and named helpers:

```js
const neutrx = require('neutrx');
const { isNeutrxError } = neutrx;

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  security: { profile: 'standard' },
});

api.get('/health').catch(error => {
  if (isNeutrxError(error)) console.error(error.toJSON());
});
```

CommonJS subpaths such as `require('neutrx/plugins')` and `require('neutrx/errors')` are also exported.

## Axios Migration Guide

Most common HTTP client patterns map cleanly:

```ts
const api = neutrx.create({ baseURL: 'https://api.example.com' });

api.interceptors.request.use(config => {
  config.headers.set('X-Service', 'billing');
  return config;
});

api.interceptors.response.use(response => response);

await api.get('/users');
await api.post('/users', { name: 'Ada' });
await api.postForm('/uploads', { name: 'report', file: new Blob(['ok']) });
```

Mutable instance defaults support common Axios migration patterns:

```ts
const api = neutrx.create({ baseURL: 'https://api.example.com' });

api.defaults.baseURL = process.env.API_URL ?? 'https://api.example.com';
api.defaults.timeout = 10_000;
api.defaults.headers.common.Authorization = `Bearer ${token}`;

await api.get('/me', {
  headers: { Authorization: `Bearer ${requestScopedToken}` },
});
```

Config is merged in this order, with each later layer overriding earlier values:

1. library defaults from `neutrx.defaults`
2. instance defaults from `neutrx.create()` and later `api.defaults` mutations
3. per-request config

Per-request config always wins, including request headers over matching default headers. Mutable defaults are shared state: changing `neutrx.defaults` affects later root requests and new instances, while changing `api.defaults` affects later requests made through that instance. Prefer per-request config for request-specific values to avoid cross-request state bugs.

Live `instance.defaults` mutation is shallow by design, with mutable `headers.common` and method header buckets. Security, resilience, and performance profiles should be set when creating a client so constructed SSRF, redirect, retry, circuit breaker, and cache behavior stays consistent.

See the full [Axios migration guide](https://xenial-devil.github.io/neutrx/axios-migration.html), [docs/axios-migration-matrix.md](docs/axios-migration-matrix.md), and [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) for behavior differences.

For frontend, edge, and shared full-stack code, see [docs/full-stack-frontend-migration.md](docs/full-stack-frontend-migration.md). It maps adapter selection, the fetch adapter, browser builds, `NeutrxHeaders`, `instance.defaults`, interceptor options, richer progress events, and common Axios workflows.

For Docker sockets, local proxies, enterprise egress gateways, timeout diagnostics, bandwidth caps, and operational utility methods, see [docs/node-infrastructure.md](docs/node-infrastructure.md).

## Request API

```ts
await api.request({ url: '/users', method: 'GET' });
await api.get('/users');
await api.post('/users', { name: 'Ada' });
await api.postUrlEncoded('/oauth/token', {
  grant_type: 'client_credentials',
  client_id: 'service',
});
await api.put('/users/1', { name: 'Ada' });
await api.patch('/users/1', { name: 'Ada Lovelace' });
await api.delete('/users/1');
await api.head('/health');
await api.options('/health');

await api.postForm('/form', { name: 'Ada' });
await api.putForm('/form/1', { name: 'Ada' });
await api.patchForm('/form/1', { name: 'Grace' });

const uri = api.getUri({ url: '/users?active=true#team', params: { page: 1 } });
```

`getUri()` builds the final URL without sending a request. Form helpers create multipart requests in Node and convert plain objects to `FormData` in browser runtimes where the platform supports it.

Useful config:

```ts
await api.get('/search', {
  params: { q: 'neutrx', tags: ['http', 'security'] },
  paramsSerializer: { indexes: false },
  allowAbsoluteUrls: true,
  auth: { username: 'service', password: process.env.API_PASSWORD ?? '' },
  idempotencyKey: 'charge-request-1',
  parseJson: text => JSON.parse(text),
  stringifyJson: value => JSON.stringify(value),
  throwHttpErrors: false,
  timeout: 5_000,
  responseEncoding: 'utf8',
  transitional: { clarifyTimeoutError: true },
  adapter: 'http',
  maxContentLength: 10 * 1024 * 1024,
  maxBodyLength: 2 * 1024 * 1024,
  maxRate: [64 * 1024, 256 * 1024],
  tls: {
    ca: process.env.UPSTREAM_CA_PEM,
    cert: process.env.CLIENT_CERT_PEM,
    key: process.env.CLIENT_KEY_PEM,
    certificatePins: [{
      hostname: 'api.example.com',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }],
  },
  signal: AbortSignal.timeout(2_000),
  beforeRedirect(context) {
    console.log(context.statusCode, context.toURL);
  },
  onDownloadProgress(event) {
    console.log(event.loaded, event.progress, event.bytes, event.rate, event.estimated);
  },
  transformResponse(data) {
    return data;
  },
});
```

Adapter selection defaults to Node HTTP in Node.js and fetch in browser-like runtimes. Use `adapter: 'http'`, `adapter: 'fetch'`, `adapter: 'http2'`, `httpVersion: 2`, or a custom adapter function when you need explicit control.

```ts
const h2 = neutrx.create({
  baseURL: 'https://api.example.com',
  httpVersion: 2,
  http2Options: {
    sessionTimeout: 60_000,
    maxSessions: 50,
    maxConcurrentStreams: 100,
  },
});
```

## Progress Events

`onUploadProgress` and `onDownloadProgress` receive Axios-style progress events:

- `loaded`: total bytes seen so far.
- `total`: expected total bytes when known from `Content-Length` or a measured body size.
- `percent`: `0` to `100` when `total` is known.
- `progress`: `0` to `1` when `total` is known.
- `bytes`: byte delta since the previous event.
- `rate`: bytes per second based on the previous event.
- `estimated`: remaining seconds when `total` and `rate` are known.

```ts
import type { ProgressEvent } from 'neutrx';

function updateProgress(label: string, event: ProgressEvent) {
  const percent = event.percent === undefined ? 'unknown' : `${event.percent.toFixed(1)}%`;
  const eta = event.estimated === undefined ? 'unknown' : `${event.estimated.toFixed(1)}s`;
  console.log(`${label}: ${percent} (${event.loaded}/${event.total ?? '?'} bytes, ${event.rate} B/s, eta ${eta})`);
}

await api.post('/reports', reportBuffer, {
  headers: { 'Content-Length': reportBuffer.byteLength },
  onUploadProgress: event => updateProgress('upload', event),
  onDownloadProgress: event => updateProgress('download', event),
});
```

Node HTTP and HTTP/2 progress is available for buffered bodies, Node streams, buffered responses, and stream responses as they are consumed. The fetch adapter uses `ReadableStream` support where the runtime exposes it. Some bodies cannot expose precise progress: browser `FormData` often hides the encoded size, fetch upload progress for opaque platform-managed bodies can only report known sizes, and `total`, `percent`, and `estimated` are omitted when no total or rate can be measured.

`security.rateLimit` and `maxRate` limit different things:

- `security.rateLimit` is request rate limiting. It controls how many requests can be sent in a time window.
- `maxRate` is Node HTTP bandwidth rate limiting. It caps upload and download bytes per second with `[uploadBytesPerSecond, downloadBytesPerSecond]`; use `0` for a direction you do not want to cap.

Cancellation uses native `AbortController`. A small `CancelToken` bridge exists for Axios migrations, but new code should prefer `signal`:

```ts
import neutrx, { CancelToken, isCancel } from 'neutrx';

const source = CancelToken.source();
const pending = neutrx.get('https://api.example.com/users', {
  cancelToken: source.token,
});

source.cancel('request no longer needed');

try {
  await pending;
} catch (error) {
  if (isCancel(error)) {
    console.log(error.message);
  }
}
```

Global defaults are mutable and apply to new root requests and new instances:

```ts
neutrx.defaults.baseURL = 'https://api.example.com';
neutrx.defaults.headers = { 'X-Service': 'billing' };

const api = neutrx.create({ timeout: 5_000 });
console.log(api.getUri({ url: '/users', params: { page: 1 } }));
```

Node-only transport options include `socketPath`, `decompress: false`, `httpAgent`, `httpsAgent`, `lookup`, upload/download `maxRate`, and `tls` for CA, mTLS client certificates, SNI, and certificate pins.

Unix socket example:

```ts
const docker = neutrx.create({
  baseURL: 'http://docker',
  socketPath: '/var/run/docker.sock',
  proxy: false,
});

await docker.get('/v1/version');
```

`socketPath` is a trusted local transport option. Neutrx validates that the path is absolute and free of unsafe characters, rejects proxy use with sockets, and only sends HTTP framing over the socket. DNS, SSRF, private-IP, HTTPS, and egress-policy network checks do not run against the synthetic URL host because no TCP connection is made; do not pass `socketPath` from untrusted input.

HTTP/2 can be selected with `httpVersion: 2` or `adapter: 'http2'` in Node.js. The adapter uses `node:http2`, reuses sessions by origin and compatible TLS settings, retires idle sessions with `http2Options.sessionTimeout`, and respects Neutrx redirect, TLS, body-size, response-size, timeout, progress, retry, circuit-breaker, cache, and metrics behavior around the transport. HTTP/2 does not support `proxy`, `socketPath`, custom `httpAgent`/`httpsAgent`, or `maxRate`; use the HTTP/1.1 adapter for those transport controls. Neutrx does not silently fall back to HTTP/1.1 when an HTTP/2 connection fails or a server does not negotiate HTTP/2. Pick `adapter: 'http'` or `httpVersion: 1` for explicit HTTP/1.1 behavior.

## Security Features

Neutrx treats outbound HTTP as a security boundary. Its security profiles combine redirect validation, sensitive-header stripping, HTTPS downgrade protection, request and response size limits, typed errors, and secret redaction.

Security profiles:

```ts
neutrx.create({ security: { profile: 'strict' } });
neutrx.create({ security: { profile: 'standard' } });
neutrx.create({ security: { profile: 'legacy' } });
```

`strict`:

- Blocks localhost, private IPv4, private IPv6, link-local, and cloud metadata IPs.
- Requires HTTPS unless explicitly disabled.
- Blocks HTTPS to HTTP redirect downgrades.
- Strips `Authorization`, `Cookie`, and `Proxy-Authorization` on cross-origin redirects.
- Redacts secrets in `error.toJSON()`.
- Enforces request and response size limits.

`standard` is for normal production service-to-service traffic. `legacy` relaxes selected network checks for trusted migrations or local testing; do not use it for untrusted user-controlled URLs.

## SSRF Protection

The Node HTTP and HTTP/2 adapters validate targets before dispatch and validate every redirect target. Depending on the selected profile and egress policy, Neutrx can block localhost, private and link-local IPs, cloud metadata targets, denied hosts and CIDRs, unsafe protocols, ports, and redirect destinations. Validated DNS records are pinned into Node requests to reduce DNS-rebinding exposure.

Browser and edge fetch runtimes do not expose DNS resolution or direct private-IP inspection, so they cannot provide the same SSRF guarantees. Enforce browser and edge outbound policy at a trusted server boundary.

SSRF allow-list example:

```ts
const locked = neutrx.create({
  security: {
    profile: 'strict',
    allowedHosts: ['api.example.com', '*.trusted.example'],
  },
  egressPolicy: {
    mode: 'webhook-target',
    allowedPorts: [443],
    requirePublicDns: true,
  },
});
```

Trusted local example:

```ts
const local = neutrx.create({
  baseURL: 'http://127.0.0.1:3000',
  security: {
    profile: 'legacy',
    blockMetadataIPs: true,
  },
});
```

See [docs/secure-egress.md](docs/secure-egress.md), [docs/security-model.md](docs/security-model.md), [docs/security.md](docs/security.md), and [THREATMODEL.md](THREATMODEL.md).

## Community

- Open issues and pull requests using [CONTRIBUTING.md](CONTRIBUTING.md), including a minimal reproduction and security impact notes when relevant.
- Keep project spaces professional and respectful under the [Code of Conduct](CODE_OF_CONDUCT.md).
- See [SUPPORT.md](SUPPORT.md) for public support expectations, maintainer response priorities, and sponsorship details.

## Support And Sustainability

Neutrx is maintained as an open-source project. Public support happens through GitHub issues, security reports belong in GitHub private vulnerability reporting, and sponsorship helps fund maintenance, security review, documentation, examples, compatibility work, and release validation.

Users and organizations that depend on Neutrx can support development through [GitHub Sponsors](https://github.com/sponsors/Xenial-Devil). OpenCollective is not configured for this project at this time.

## Service Discovery

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

Resolvers can be static arrays or async functions. Discovery applies to relative URLs, and the selected endpoint still goes through SSRF, redirect, TLS, and egress policy checks.

## Retries

Retries use exponential backoff with jitter by default. Only idempotent methods (`GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`) retry by default.

```ts
const api = neutrx.create({
  resilience: {
    enableRetry: true,
    maxRetries: 3,
    retryDelay: 250,
    maxRetryDelay: 5_000,
    retryJitter: true,
    retryBudget: {
      maxRetries: 100,
      windowMs: 60_000,
      scope: 'origin',
      namespace: 'billing-api',
    },
  },
});
```

`Retry-After` is respected when returned on retryable HTTP errors.

`POST` and `PATCH` do not retry by default. Setting `idempotencyKey` adds the `Idempotency-Key` header and lets Neutrx retry those methods when the failure is otherwise retryable.

`retryBudget.store` can point at a first-party or userland shared budget store so multiple workers/pods spend one retry pool without adding Redis or other dependencies to core.

## Circuit Breaker

```ts
const api = neutrx.create({
  resilience: {
    enableCircuitBreaker: true,
    failureThreshold: 5,
    successThreshold: 2,
    circuitTimeout: 30_000,
    circuitBreakerStorage: {
      store: sharedCircuitStore,
      scope: 'origin',
      namespace: 'billing-api',
    },
    adaptiveConcurrency: {
      enabled: true,
      initialLimit: 10,
      minLimit: 2,
      maxLimit: 50,
      targetLatency: 500,
    },
  },
});

api.on('request:error', event => console.error(event));
console.log(api.getCircuitStatus());
```

States are `CLOSED`, `OPEN`, and `HALF_OPEN`.

## Bulkhead Isolation

Bulkheads cap active and queued work per target so one slow upstream cannot consume all outbound request capacity:

```ts
const api = neutrx.create({
  baseURL: 'https://catalog.example.com',
  resilience: {
    enableBulkhead: true,
    maxConcurrent: 20,
    maxQueue: 50,
    bulkheadQueueTimeout: 5_000,
    adaptiveConcurrency: {
      enabled: true,
      initialLimit: 10,
      minLimit: 2,
      maxLimit: 30,
      targetLatency: 500,
    },
  },
});

console.log(api.getBulkheadStats());
```

Each target domain receives an independent pool. Requests beyond `maxConcurrent` wait up to `maxQueue`; queued requests that exceed `bulkheadQueueTimeout` fail with `NeutrxBulkheadError`. See [bulkhead isolation](docs/bulkhead-isolation.md).

## Cache

GET caching is in-memory and respects common cache headers where practical.

```ts
const api = neutrx.create({
  performance: {
    enableCaching: true,
    deduplicateRequests: true,
    deduplicateRequestKey: config => `${config.method}:${config.url}:${config.headers.get('X-Tenant-ID') ?? ''}`,
    cacheStrategy: 'swr',
    cacheTTL: 300_000,
    revalidateAfter: 60_000,
    cacheStaleMax: 1_500_000,
    respectCacheHeaders: true,
    onRevalidate(event) {
      console.log(event.url, event.updated, event.status);
    },
  },
});

await api.get('/users');
console.log(api.getCacheStats());
api.clearCache();
api.invalidateCache(/\/users/u);
api.deleteCacheEntry('/users');
```

Request deduplication is enabled by default for identical inflight `GET`/`HEAD` requests; joined responses set `response.deduplicated = true`. Set `deduplicateRequests: false` to disable it. Unsafe methods are excluded unless explicitly added with `deduplicateMethods`; include an application-safe discriminator such as an idempotency key in `deduplicateRequestKey` when opting in. The default key uses method, final URL including serialized params, response type, adapter, socket path, and selected headers (`Accept`, `Authorization`, and `Range`). Dedup hits are exposed in `api.getMetrics().requests.deduplicated` and Prometheus output.

With `cacheStrategy: 'swr'`, entries are fresh until `revalidateAfter` or normal max-age expiry, then stale hits return immediately with `response.cached = true` and `response.stale = true` while Neutrx refreshes them in the background. Only one background refresh runs per cache key; duplicate stale hits keep returning the stale response. Cached responses with `ETag`, `Last-Modified`, and `stale-if-error` headers participate in conditional revalidation and stale fallback. `performance.cacheAdapter` can provide a process-local compatible store and refresh lock; Redis remains an optional package direction outside core.

## Metrics

Every client exposes an in-process metrics snapshot and Prometheus text without requiring a monitoring dependency:

```ts
const metrics = api.getMetrics();

console.log(metrics.requests.active);
console.log(metrics.requests.retried);
console.log(metrics.requests.deduplicated);
console.log(metrics.errors.byCategory);

const prometheusText = api.getMetricsPrometheus();
```

Metrics cover totals, active requests, success and error counts, retries, cache and deduplication hits, status codes, redacted endpoint keys, error codes and categories, and request-duration statistics. Lifecycle events and the optional OpenTelemetry bridge provide richer integration points. See [observability](docs/observability.md).

## Interceptors

```ts
const id = api.interceptors.request.use(
  config => {
    config.headers.set('X-Trace', 'abc');
    return config;
  },
  undefined,
  {
    synchronous: true,
    runWhen: config => config.method === 'GET',
  }
);

api.interceptors.request.eject(id);
api.interceptors.request.clear();
api.interceptors.response.clear();
```

## Response Schema Validation

Use `schema` to validate and optionally transform parsed response data before it is returned. Neutrx does not depend on Zod, TypeBox, Ajv, or any validator; pass any compatible `safeParse`, `parse`, `validate`, `Check/Errors`, or function validator. Set `schema: false` on a request to disable a client default schema for that call.

```ts
import neutrx, { NeutrxValidationError, type ResponseValidationSchema } from 'neutrx';

type User = { readonly id: string; readonly name: string };

const userSchema = {
  safeParse(value: unknown) {
    return value && typeof value === 'object' && 'id' in value && 'name' in value
      ? { success: true as const, data: value as User }
      : { success: false as const, issues: [{ path: ['id'], message: 'user response is invalid' }] };
  },
} satisfies ResponseValidationSchema<User>;

try {
  const response = await api.get('/users/1', { schema: userSchema });
  response.data.id; // typed as string
} catch (error) {
  if (error instanceof NeutrxValidationError) console.error(error.issues);
}
```

## Plugins

Plugins extend the client lifecycle without adding required runtime dependencies to Neutrx core:

```ts
import neutrx, {
  LogPlugin,
  ValidationPlugin,
  createOtelPlugin,
  createTraceContextPlugin,
} from 'neutrx';

const api = neutrx.create({ baseURL: 'https://api.example.com' });

api
  .use(LogPlugin)
  .use(ValidationPlugin)
  .use(createTraceContextPlugin())
  .use(createOtelPlugin({ tracerName: 'billing-http' }));
```

Built-in plugins cover logging, validation, OAuth2, GraphQL, mocks, WebSocket workflows, dependency-free trace-context propagation, and an optional OpenTelemetry bridge. Custom plugins can implement the typed `NeutrxPlugin` lifecycle. See [plugins](docs/plugins.md).

## Validation Plugin

`ValidationPlugin` validates request bodies and parsed responses with user-provided schemas. Use first-class `schema` for normal response validation; use the plugin when you also want request-body validation or centrally configured validation hooks. It has no runtime dependency on Zod, TypeBox, Ajv, or any validator.

```ts
import neutrx, { ValidationPlugin } from 'neutrx';

const api = neutrx.create({ baseURL: 'https://api.example.com' });
api.use(ValidationPlugin);

const userResponse = {
  safeParse(value: unknown) {
    return typeof value === 'object' && value !== null && 'id' in value
      ? { success: true, data: value }
      : { success: false, issues: [{ path: ['id'], message: 'id is required' }] };
  },
};

const user = await api.get('/users/1', {
  validation: { response: userResponse },
});
```

Validation failures throw `NeutrxValidationError` and do not retry.

## WebSocket, Logging, Trace Context, And OpenTelemetry

```ts
import neutrx, { LogPlugin, createOtelPlugin, createTraceContextPlugin } from 'neutrx';

const api = neutrx.create({ baseURL: 'https://api.example.com' });
api.use(LogPlugin);
api.setLogger(console);

api.use(createTraceContextPlugin({
  formats: ['w3c', 'b3-multi', 'b3-single'],
  sampled: true,
}));

api.use(createOtelPlugin({
  tracerName: 'billing-http',
  propagateTraceHeaders: true,
}));

const realtime = await api.ws<{ event: string }>('/realtime', {
  headers: { Authorization: 'Bearer service-token' },
  reconnect: { attempts: 5, delay: 500, backoff: 'exponential', maxDelay: 30_000 },
  parseMessage: data => JSON.parse(String(data)) as { event: string },
  onMessage: message => console.log(message.event),
});

realtime.send('hello');
```

`api.ws()` reuses `baseURL`, default headers, basic auth, params, service discovery, plugin request hooks, and request interceptors before opening the connection. In Node, Neutrx performs the HTTP upgrade directly so prepared headers such as `Authorization` are sent with the handshake. In browsers, Neutrx uses the platform `WebSocket`; the browser API does not allow custom handshake headers, but URL preparation and request interceptors still run before construction.

`TraceContextPlugin` injects W3C `traceparent` by default and can also emit `tracestate`, B3 multi-header, and B3 single-header propagation. Existing user-supplied trace headers are preserved unless you set `overwrite: true`. When the OpenTelemetry bridge injects carrier headers, the trace context plugin reuses that context for any additional requested formats.

The OpenTelemetry plugin detects `@opentelemetry/api` when your application installs it, but Neutrx does not require it. Propagation uses the newly created client span, retries become span events, and spans include safe request and response attributes such as method, path target, host, retry count, status code, cache hit or miss, duration, and circuit breaker state. Errors record exceptions, stable error categories, and failure status. `response.traceContext` exposes the resolved trace identity.

Install the optional peer only in applications that enable the OpenTelemetry bridge:

```bash
npm install @opentelemetry/api
```

## Error Handling

```ts
import { NeutrxHTTPError, isNeutrxError, toStructuredError } from 'neutrx';

try {
  await api.get('/users');
} catch (error) {
  if (!isNeutrxError(error)) throw error;
  console.error(error.code, error.toJSON());
  if (error instanceof NeutrxHTTPError) console.error(error.status);
}
```

`throwHttpErrors: false` returns non-2xx responses instead of throwing. `error.toJSON()` redacts sensitive URL params, headers, response fields, and causes while exposing a stable error category plus trace and request identity. Use `toStructuredError(error)` to safely normalize third-party errors for logs.

## TypeScript Support

```ts
import neutrx, { type NeutrxResponse } from 'neutrx';

type User = { readonly id: string; readonly name: string };

const response: NeutrxResponse<readonly User[]> = await neutrx.get('/users');
response.data[0]?.name;
```

Neutrx is written in strict TypeScript and ships declarations for the root, Node, browser, plugin, error, header, instrumentation, and adapter exports. Generic response data and schema inference preserve application types without a separate `@types` package.

## Browser Platform Limits

Browser support exists through `neutrx/browser` and the package `browser` condition. In browser bundlers, `import neutrx from 'neutrx'` resolves to the browser build; you can also import `neutrx/browser` explicitly.

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  adapter: 'fetch',
  credentials: 'include',
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
});

const users = await api.get('/users', {
  responseType: 'json',
  signal: AbortSignal.timeout(5_000),
  onDownloadProgress(event) {
    console.log(event.loaded, event.progress);
  },
});

const profilePhoto = await api.get<Blob>('/me/photo', {
  responseType: 'blob',
});
```

The browser adapter uses native `fetch`, `Request`, `Response`, and `Headers`. It supports request method, headers, body, abort signals, `json`, `text`, `blob`, and `arrayBuffer` responses, plus progress where fetch exposes body sizes or readable streams.

Browser runtimes do not expose the same transport controls as Node:

- No raw socket access, Unix sockets, custom agents, proxy tunneling, or socket-level rate limiting.
- No certificate pinning, custom CA, or mTLS client certificate control from normal browser JavaScript.
- No direct DNS resolution or private IP inspection in the standard browser runtime; SSRF and DNS pinning guarantees are Node HTTP adapter features.
- Browser upload progress is limited to body types with known sizes; download progress depends on fetch stream support and response headers.

Neutrx remains backend-focused; browser support is useful when you want the same request ergonomics in frontend code while accepting normal browser platform limits.

## API Reference

See the full [API reference](https://xenial-devil.github.io/neutrx/api.html), [docs/config-reference.md](docs/config-reference.md), [docs/adapter-security-contract.md](docs/adapter-security-contract.md), and [docs/recipes/backend-recipes.md](docs/recipes/backend-recipes.md).

## Testing

```bash
npm install
npm test
npm run coverage
npm run build
npm run typecheck
npm run lint
npm run package:validate
npm run package:smoke
npm run release:validate
```

Tests use local servers and `node:test`. Security tests cover SSRF blocks, DNS validation, redirect header stripping, downgrade blocking, cache behavior, retry/circuit behavior, interceptors, ESM/CJS package imports, and TypeScript declarations. `npm run coverage` uses c8, emits text and lcov reports, and enforces minimum coverage thresholds for the built core, security, resilience, and performance modules.

Before publishing, use the full [release testing checklist](docs/release-testing.md).

## Benchmarks

```bash
npm run benchmark
npm run benchmark:http
```

Benchmarks are scripts only. They do not publish fake results. Optional comparison scripts may include additional clients only when those packages are installed by the caller.

## Release And Supply Chain

- Releases use Conventional Commits, `semantic-release`, and the locked `conventional-changelog` generator.
- `CHANGELOG.md` records notable changes, with release highlights for users evaluating security, migration, and backend behavior.
- `npm ci`, lint, typecheck, tests, coverage, build, package validation, and packed-package smoke tests run in CI and before publishing.
- Dependency Review and CodeQL workflows are included.
- Release workflow has `id-token: write`; prefer npm trusted publishing/provenance for npm publishing.
- The GitHub release page is the canonical public release note surface. For example, `v1.0.0` is available at <https://github.com/Xenial-Devil/neutrx/releases/tag/v1.0.0>.
- `.npmrc` sets `ignore-scripts=true`.
- Maintainers can preview generated notes with `npm run changelog:preview`; use `npm run changelog:write` only when intentionally refreshing `CHANGELOG.md` outside the automated release.
- See [docs/release-security.md](docs/release-security.md).

## Security Disclosure

Report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/Xenial-Devil/neutrx/security/advisories/new). Do not include exploit details in public issues, pull requests, discussions, social posts, or proofs of concept before maintainer review.

Include the affected version or commit, impact, reproduction steps, a minimal private proof of concept when safe, known workarounds, and any suggested fix. See [SECURITY.md](SECURITY.md) for supported versions, response expectations, and disclosure rules.

## License

Neutrx is open-source software licensed under the [MIT License](LICENSE).
