# Neutrx

[![CI](https://github.com/Xenial-Devil/neutrx/actions/workflows/ci.yml/badge.svg)](https://github.com/Xenial-Devil/neutrx/actions/workflows/ci.yml)
[![Codecov](https://codecov.io/gh/Xenial-Devil/neutrx/branch/main/graph/badge.svg)](https://codecov.io/gh/Xenial-Devil/neutrx)
[![npm version](https://img.shields.io/npm/v/neutrx.svg)](https://www.npmjs.com/package/neutrx)
[![GitHub release](https://img.shields.io/github/v/release/Xenial-Devil/neutrx?sort=semver)](https://github.com/Xenial-Devil/neutrx/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![Runtime deps: 0](https://img.shields.io/badge/runtime_deps-0-brightgreen.svg)](package.json)
[![Sponsor](https://img.shields.io/badge/sponsor-GitHub%20Sponsors-fafbfc?logo=githubsponsors)](https://github.com/sponsors/Xenial-Devil)

Neutrx is a security-first HTTP client for Node.js 18+ backends. It keeps an ergonomic request API, then adds production concerns that backend services usually need: SSRF protection, secure redirects, retries, circuit breaking, service discovery, in-memory caching, metrics hooks, OpenTelemetry-friendly instrumentation, typed errors, and zero required runtime dependencies.

Full documentation: [https://xenial-devil.github.io/neutrx/](https://xenial-devil.github.io/neutrx/).

## Installation

```bash
npm install neutrx
```

## Node Version Support

Neutrx supports **Node.js >=18.0.0** for backend runtimes.

CI tests Node 18, 20, and 22. The library targets modern Node APIs available across that range: native `fetch`, `AbortController`, Web Streams, `Blob`, `FormData`, `URL`, `URLSearchParams`, and `node:test`.

## Quick Start

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  security: { profile: 'standard' },
});

const users = await api.get('/users', { params: { page: 1 } });
const created = await api.post('/users', { name: 'Ada Lovelace' });
const direct = await neutrx('https://api.example.com/health');
```

CommonJS is supported too:

```js
const neutrx = require('neutrx');
const { isNeutrxError } = neutrx;
```

## Migration From Other HTTP Clients

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

Request config still overrides instance defaults. Live `instance.defaults` mutation is shallow by design, with mutable `headers.common` and method header buckets. Security, resilience, and performance profiles should be set when creating a client so constructed SSRF, redirect, retry, circuit breaker, and cache behavior stays consistent.

See the full [Axios migration guide](https://xenial-devil.github.io/neutrx/axios-migration.html), [docs/axios-migration-matrix.md](docs/axios-migration-matrix.md), and [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) for behavior differences.

For frontend, edge, and shared full-stack code, see [docs/full-stack-frontend-migration.md](docs/full-stack-frontend-migration.md). It maps adapter selection, the fetch adapter, browser builds, `NeutrxHeaders`, `instance.defaults`, interceptor options, richer progress events, and common Axios workflows.

For Docker sockets, local proxies, enterprise egress gateways, timeout diagnostics, bandwidth caps, and operational utility methods, see [docs/node-infrastructure.md](docs/node-infrastructure.md).

## Why Neutrx

| Area | Neutrx posture |
| --- | --- |
| Runtime target | Node.js >=18, backend-first |
| Dependencies | No required runtime dependencies |
| Security posture | SSRF protection, redirect stripping, size limits, redacted errors |
| Retry/circuit/cache | Built in |
| Service discovery | Resolver interface with round-robin, random, and sticky-origin selection |
| Types | TypeScript source and declarations |
| Observability | Metrics snapshot, events, optional OpenTelemetry bridge |
| Browser support | Separate browser entry, secondary |

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

## Security Defaults

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

## Security And Community

- Report suspected vulnerabilities privately through [SECURITY.md](SECURITY.md). Do not include exploit details in public issues, pull requests, discussions, or social posts.
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

## Retry

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

With `deduplicateRequests`, identical inflight `GET`/`HEAD` requests share one dispatch and joined responses set `response.deduplicated = true`. The default key uses method, final URL including serialized params, response type, adapter, socket path, and selected headers (`Accept`, `Authorization`, and `Range`). Use `deduplicateRequestKey` for service-specific keys, and set `deduplicateMethods` only when you explicitly want to coalesce other methods. Dedup hits are exposed in `api.getMetrics().requests.deduplicated` and Prometheus output. With `cacheStrategy: 'swr'`, entries are fresh until `revalidateAfter` or normal max-age expiry, then stale hits return immediately with `response.cached = true` and `response.stale = true` while Neutrx refreshes them in the background. Only one background refresh runs per cache key; duplicate stale hits keep returning the stale response. Cached responses with `ETag`, `Last-Modified`, and `stale-if-error` headers participate in conditional revalidation and stale fallback. `performance.cacheAdapter` can provide a process-local compatible store and refresh lock; Redis remains an optional package direction outside core.

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

The OpenTelemetry plugin detects `@opentelemetry/api` when your application installs it, but Neutrx does not require it. Spans include safe request and response attributes such as method, path target, host, retry count, status code, cache hit or miss, duration, and circuit breaker state. Errors record exceptions and mark the span as failed.

## Error Handling

```ts
import { NeutrxHTTPError, isNeutrxError } from 'neutrx';

try {
  await api.get('/users');
} catch (error) {
  if (!isNeutrxError(error)) throw error;
  console.error(error.code, error.toJSON());
  if (error instanceof NeutrxHTTPError) console.error(error.status);
}
```

`throwHttpErrors: false` returns non-2xx responses instead of throwing. `error.toJSON()` redacts sensitive URL params, headers, and response fields such as tokens, cookies, passwords, secrets, and API keys.

## TypeScript

```ts
type User = { id: string; name: string };
const response = await api.get<readonly User[]>('/users');
```

The project uses strict TypeScript, `NodeNext`, and generated declaration files.

## Browser Support Status

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
```

Tests use local servers and `node:test`. Security tests cover SSRF blocks, DNS validation, redirect header stripping, downgrade blocking, cache behavior, retry/circuit behavior, interceptors, ESM/CJS package imports, and TypeScript declarations. `npm run coverage` uses c8, emits text and lcov reports, and enforces minimum coverage thresholds for the built core, security, resilience, and performance modules.

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

## License

Neutrx is open-source software licensed under the [MIT License](LICENSE).
