# Full-Stack And Frontend Migration

Use this guide when you want Neutrx request ergonomics in browser, edge, SSR, and backend code while keeping the backend security controls explicit. Neutrx is still backend-first; browser support is for shared workflows and frontend fetch ergonomics, not for browser-side SSRF guarantees.

## Runtime Choice

| Runtime | Entry | Default adapter | Best fit |
| --- | --- | --- | --- |
| Node.js backend | `neutrx` or `neutrx/node` | `http` | Secure service-to-service egress, redirects, TLS, DNS, retries, cache, metrics |
| Browser bundler | `neutrx` through the `browser` condition, or `neutrx/browser` | `fetch` | Frontend API clients with Axios-like defaults, interceptors, headers, cancellation, XSRF, and progress |
| Edge or worker runtime | `neutrx/browser` | `fetch` | Fetch-compatible runtimes without `window` or `document`; XSRF cookies only work in standard browser environments |

Browser builds use platform APIs: `fetch`, `Request`, `Response`, `Headers`, `AbortController`, `Blob`, `FormData`, and readable streams when available. Node-only controls such as custom DNS lookup, private IP inspection, custom agents, Unix sockets, mTLS, certificate pins, and socket bandwidth limits remain Node adapter features.

## Adapter Architecture

Adapters are transport boundaries. The client lifecycle stays outside the adapter:

- Request defaults and transforms are resolved before dispatch.
- Request interceptors run before adapter selection.
- Built-in `http`, `fetch`, and `http2` adapter names can be selected per client or request.
- Custom adapters receive a prepared `NeutrxRequestConfig` and return a `RawHttpResponse`.
- Retries, circuit breaker, cache, metrics, response parsing, schema validation, and response interceptors run around the adapter.
- Custom adapters that should reject URL mutation and adapter-owned redirects can be wrapped with `createSecureAdapter()`.

```ts
import neutrx, { FetchAdapter, HttpAdapter } from 'neutrx';

const serverApi = neutrx.create({
  baseURL: 'https://billing.internal.example',
  adapter: HttpAdapter,
  security: { profile: 'standard' },
});

const browserApi = neutrx.create({
  baseURL: '/api',
  adapter: FetchAdapter,
});
```

## Fetch Adapter And Browser Build

In browser bundlers, the root import can resolve to the browser build through the package `browser` condition. Use `neutrx/browser` when you want the browser entry explicitly.

```ts
import neutrx from 'neutrx/browser';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  adapter: 'fetch',
  withCredentials: true,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
});

const users = await api.get('/users', {
  responseType: 'json',
  signal: AbortSignal.timeout(5_000),
});
```

The browser fetch adapter supports JSON, text, Blob, ArrayBuffer, FormData, abort signals, timeouts, XSRF helpers, credentials, upload progress where body size is visible, and download progress where the runtime exposes readable response streams.

## NeutrxHeaders

`NeutrxHeaders` gives browser and Node code one header shape with case-insensitive lookup, iterable entries, safe normalization, redaction helpers, and a `false` sentinel for blocking automatic headers.

```ts
import { NeutrxHeaders } from 'neutrx/browser';

const headers = new NeutrxHeaders({ Authorization: 'Bearer token' });
headers.set('X-Tenant-ID', 'acme');
headers.setContentType(false); // block inferred Content-Type

for (const [name, value] of headers) {
  console.log(name, value);
}
```

Use `headers.redactSensitive()` before logging request context.

## Mutable Defaults

Neutrx supports common Axios-style `instance.defaults` workflows:

```ts
const api = neutrx.create({ baseURL: '/api' });

api.defaults.baseURL = import.meta.env.VITE_API_URL ?? '/api';
api.defaults.timeout = 10_000;
api.defaults.headers.common.Authorization = `Bearer ${token}`;
api.defaults.headers.get['X-Mode'] = 'read';

await api.get('/me', {
  headers: { Authorization: `Bearer ${requestToken}` },
});
```

Request config still wins over instance defaults. Live mutation is intentionally shallow: use mutable defaults for request ergonomics such as base URL, timeout, auth headers, credentials, and adapters. Configure security, egress, resilience, and performance policy when creating a client so constructed components stay consistent.

## Interceptor Options

Request interceptors support Axios-like options:

```ts
const id = api.interceptors.request.use(
  config => {
    config.headers.set('X-Trace-ID', crypto.randomUUID());
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

`synchronous` lets simple request mutations run before the async chain starts. `runWhen` skips work for requests where the interceptor does not apply.

## Progress Events

`onUploadProgress` and `onDownloadProgress` receive richer Axios-style progress events:

- `loaded`: bytes seen so far.
- `total`: known total bytes.
- `percent`: `0` to `100` when `total` is known.
- `progress`: `0` to `1` when `total` is known.
- `bytes`: delta since the previous event.
- `rate`: bytes per second since the previous event.
- `estimated`: remaining seconds when `total` and `rate` are known.
- `upload` or `download`: direction flags.

```ts
await api.post('/uploads', file, {
  headers: { 'Content-Type': file.type },
  onUploadProgress(event) {
    renderUpload(event.loaded, event.total, event.progress);
  },
  onDownloadProgress(event) {
    renderDownload(event.loaded, event.total, event.rate);
  },
});
```

Browser progress depends on platform visibility. `Blob`, strings, typed arrays, and URL-encoded bodies can usually report upload totals. Browser `FormData` often hides its encoded size. Download totals depend on `Content-Length`, and streaming progress depends on readable response body support.

## Axios Migration Map

| Axios workflow | Neutrx workflow |
| --- | --- |
| `axios.create({ baseURL })` | `neutrx.create({ baseURL })` |
| `axios.get('/users', { params })` | `api.get('/users', { params })` |
| `axios.post('/users', data)` | `api.post('/users', data)` |
| `instance.defaults.headers.common.Authorization = token` | `api.defaults.headers.common.Authorization = token` |
| `axios.interceptors.request.use(fn, err, { runWhen })` | `api.interceptors.request.use(fn, err, { runWhen, synchronous })` |
| `onUploadProgress` / `onDownloadProgress` | Same names, with `bytes`, `rate`, `estimated`, `upload`, and `download` fields |
| Browser XSRF config | `xsrfCookieName`, `xsrfHeaderName`, `withXSRFToken`, `withCredentials`, `credentials` |
| `CancelToken` | `AbortController` preferred; `CancelToken.source()` bridge is available |
| Custom adapter | `adapter: 'http'`, `'fetch'`, `'http2'`, or a custom adapter function |

See [Axios migration guide](axios-migration.md), [Axios migration matrix](axios-migration-matrix.md), and [Browser usage](browser-usage.md) for the full compatibility details.
