# Neutrx

Neutrx is a security-first HTTP client for Node.js 22+ backends. It keeps an ergonomic request API, then adds production concerns that backend services usually need: SSRF protection, secure redirects, retries, circuit breaking, service discovery, in-memory caching, metrics hooks, OpenTelemetry-friendly instrumentation, typed errors, and zero required runtime dependencies.

## Installation

```bash
npm install neutrx
```

## Node Version Support

Neutrx supports **Node.js >=22.0.0 only**. Node 18 and Node 20 are intentionally unsupported and are not tested in CI.

CI currently tests Node 22, 24, and 25. The library targets modern Node APIs: native `fetch`, `AbortController`, Web Streams, `Blob`, `FormData`, `URL`, `URLSearchParams`, and `node:test`.

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
const { default: neutrx, isNeutrxError } = require('neutrx');
```

## Migration From Other HTTP Clients

Most common HTTP client patterns map cleanly:

```ts
const api = neutrx.create({ baseURL: 'https://api.example.com' });

api.interceptors.request.use(config => ({
  ...config,
  headers: { ...config.headers, 'X-Service': 'billing' },
}));

api.interceptors.response.use(response => response);

await api.get('/users');
await api.post('/users', { name: 'Ada' });
await api.postForm('/uploads', { name: 'report', file: new Blob(['ok']) });
```

See [docs/axios-migration-matrix.md](docs/axios-migration-matrix.md), [docs/migration-from-http-clients.md](docs/migration-from-http-clients.md), and [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) for behavior differences.

## Why Neutrx

| Area | Neutrx posture |
| --- | --- |
| Runtime target | Node.js >=22, backend-first |
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
```

Useful config:

```ts
await api.get('/search', {
  params: { q: 'neutrx', tags: ['http', 'security'] },
  paramsSerializer: { indexes: false },
  auth: { username: 'service', password: process.env.API_PASSWORD ?? '' },
  idempotencyKey: 'charge-request-1',
  parseJson: text => JSON.parse(text),
  stringifyJson: value => JSON.stringify(value),
  throwHttpErrors: false,
  timeout: 5_000,
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
  onDownloadProgress(event) {
    console.log(event.loaded, event.bytes, event.rate, event.estimated);
  },
  transformResponse(data) {
    return data;
  },
});
```

Adapter selection defaults to Node HTTP in Node.js and fetch in browser-like runtimes. Use `adapter: 'http'`, `adapter: 'fetch'`, `adapter: 'http2'`, or a custom adapter function when you need explicit control.

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
    cacheStrategy: 'stale-while-revalidate',
    cacheTTL: 300_000,
    cacheStaleMax: 1_500_000,
    respectCacheHeaders: true,
  },
});

await api.get('/users');
console.log(api.getCacheStats());
api.clearCache();
```

With `deduplicateRequests`, identical inflight `GET`/`HEAD` requests share one dispatch and joined responses set `response.deduplicated = true`. With `cacheStrategy: 'stale-while-revalidate'`, expired-but-allowed cache entries return immediately with `response.stale = true` while Neutrx refreshes them in the background. Cached responses with `ETag`, `Last-Modified`, and `stale-if-error` headers participate in conditional revalidation and stale fallback. `performance.cacheAdapter` can provide a process-local compatible store and refresh lock; Redis remains an optional package direction outside core.

## Interceptors

```ts
const id = api.interceptors.request.use(
  config => ({ ...config, headers: { ...config.headers, 'X-Trace': 'abc' } }),
  undefined,
  { runWhen: config => config.method === 'GET' }
);

api.interceptors.request.eject(id);
api.interceptors.response.clear();
```

## Validation Plugin

`ValidationPlugin` validates request bodies and parsed responses with user-provided schemas. It has no runtime dependency on Zod, TypeBox, Ajv, or any validator; pass a `safeParse`, `parse`, `validate`, `Check/Errors`, or function validator.

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

Browser support exists through `neutrx/browser` and the package `browser` condition. It uses native fetch, browser streams, credentials, XSRF cookie/header injection, timeout, and progress where fetch exposes streams. Neutrx remains backend-focused; Node adapters, DNS validation, certificate pinning, proxy tunneling, and request signing are Node-only.

## API Reference

See [docs/api.md](docs/api.md), [docs/config-reference.md](docs/config-reference.md), [docs/adapter-security-contract.md](docs/adapter-security-contract.md), and [docs/recipes/backend-recipes.md](docs/recipes/backend-recipes.md).

## Testing

```bash
npm install
npm test
npm run build
npm run typecheck
npm run lint
npm run package:validate
npm run package:smoke
```

Tests use local servers and `node:test`. Security tests cover SSRF blocks, DNS validation, redirect header stripping, downgrade blocking, cache behavior, retry/circuit behavior, interceptors, ESM/CJS package imports, and TypeScript declarations.

## Benchmarks

```bash
npm run benchmark
npm run benchmark:http
```

Benchmarks are scripts only. They do not publish fake results. Optional comparison scripts may include additional clients only when those packages are installed by the caller.

## Release And Supply Chain

- `npm ci`, lint, typecheck, tests, coverage, build, package validation, and packed-package smoke tests run in CI.
- Dependency Review and CodeQL workflows are included.
- Release workflow has `id-token: write`; prefer npm trusted publishing/provenance when the package is ready.
- Release workflow uses npm provenance settings and does not require a long-lived npm token path.
- `.npmrc` sets `ignore-scripts=true`.
- See [docs/release-security.md](docs/release-security.md).

## License

Neutrx is source-available under a restrictive project license. See [LICENSE](LICENSE).
