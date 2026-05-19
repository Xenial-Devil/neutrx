# Neutrx

Neutrx is a security-first HTTP client for Node.js 22+ backends. It keeps an ergonomic request API, then adds production concerns that backend services usually need: SSRF protection, secure redirects, retries, circuit breaking, in-memory caching, metrics hooks, OpenTelemetry-friendly instrumentation, typed errors, and zero required runtime dependencies.

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

See [docs/migration-from-http-clients.md](docs/migration-from-http-clients.md) and [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) for behavior differences.

## Why Neutrx

| Area | Neutrx posture |
| --- | --- |
| Runtime target | Node.js >=22, backend-first |
| Dependencies | No required runtime dependencies |
| Security posture | SSRF protection, redirect stripping, size limits, redacted errors |
| Retry/circuit/cache | Built in |
| Types | TypeScript source and declarations |
| Observability | Metrics snapshot, events, optional OpenTelemetry bridge |
| Browser support | Separate browser entry, secondary |

## Request API

```ts
await api.request({ url: '/users', method: 'GET' });
await api.get('/users');
await api.post('/users', { name: 'Ada' });
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
  paramsSerializer: params => new URLSearchParams(params as Record<string, string>).toString(),
  parseJson: text => JSON.parse(text),
  stringifyJson: value => JSON.stringify(value),
  throwHttpErrors: false,
  timeout: 5_000,
  adapter: 'http',
  maxContentLength: 10 * 1024 * 1024,
  maxBodyLength: 2 * 1024 * 1024,
  maxRate: [64 * 1024, 256 * 1024],
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

Global defaults are mutable and apply to new root requests and new instances:

```ts
neutrx.defaults.baseURL = 'https://api.example.com';
neutrx.defaults.headers = { 'X-Service': 'billing' };

const api = neutrx.create({ timeout: 5_000 });
console.log(api.getUri({ url: '/users', params: { page: 1 } }));
```

Node-only transport options include `socketPath`, `decompress: false`, `httpAgent`, `httpsAgent`, `lookup`, and upload/download `maxRate`.

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

See [docs/security-model.md](docs/security-model.md), [docs/security.md](docs/security.md), and [THREATMODEL.md](THREATMODEL.md).

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
    retryBudget: { maxRetries: 100, windowMs: 60_000 },
  },
});
```

`Retry-After` is respected when returned on retryable HTTP errors.

## Circuit Breaker

```ts
const api = neutrx.create({
  resilience: {
    enableCircuitBreaker: true,
    failureThreshold: 5,
    successThreshold: 2,
    circuitTimeout: 30_000,
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

With `deduplicateRequests`, identical inflight `GET`/`HEAD` requests share one dispatch and joined responses set `response.deduplicated = true`. With `cacheStrategy: 'stale-while-revalidate'`, expired-but-allowed cache entries return immediately with `response.stale = true` while Neutrx refreshes them in the background. Redis/custom cache adapters are not implemented yet; see docs for extension direction.

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

See [docs/api.md](docs/api.md) and [docs/config-reference.md](docs/config-reference.md).

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
- Avoid long-lived `NPM_TOKEN` where trusted publishing is available.

## License

Neutrx is source-available under a restrictive project license. See [LICENSE](LICENSE).
