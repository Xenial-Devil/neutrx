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
- `data`
- `timeout`
- `connectTimeout`
- `signal`
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
- `proxy`
- `lookup`
- `httpAgent`
- `httpsAgent`
- `socketPath` (Node only)
- `decompress` (Node only)
- `maxRate` (Node only, bytes per second or `[upload, download]`)
- `security`
- `resilience`
- `performance`
- `instrumentation`
- `onUploadProgress`
- `onDownloadProgress`

Progress events include `loaded`, `total`, `percent`, `bytes`, `rate`, `estimated`, and `upload` or `download`.

Adapters can be selected with `adapter: 'http'`, `adapter: 'fetch'`, `adapter: 'http2'`, constants such as `HttpAdapter`, or a custom adapter function. Node uses HTTP by default; browser-like runtimes use fetch.

Responses include `request` when the adapter can expose a safe transport reference: Node HTTP returns `ClientRequest`, fetch returns `Request` where possible.

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
  retryBudget: { maxRetries: 100, windowMs: 60_000 },
  enableCircuitBreaker: true,
  failureThreshold: 5,
  successThreshold: 2,
  circuitTimeout: 30_000,
}
```

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
}
```

## Interceptors

```ts
const id = api.interceptors.request.use(config => config);
api.interceptors.request.eject(id);
api.interceptors.request.clear();

api.interceptors.response.use(response => response, error => error);
api.interceptors.response.clear();
```

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
