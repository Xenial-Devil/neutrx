# Node Infrastructure Usage

Neutrx can be used for Docker Engine calls, local proxy egress, enterprise HTTP gateways, and backend data-transfer jobs without adding runtime dependencies. These controls are Node-oriented and are strongest with the default `http` adapter.

## socketPath

Use `socketPath` for trusted local HTTP-over-socket services such as Docker Engine or internal daemon APIs:

```ts
import neutrx from 'neutrx';

const docker = neutrx.create({
  baseURL: 'http://docker',
  socketPath: '/var/run/docker.sock',
  proxy: false,
  timeout: 5_000,
  maxContentLength: 2 * 1024 * 1024,
});

const version = await docker.get('/v1/version');
```

With `socketPath`, Neutrx connects to the absolute local socket path and uses the URL host only as the HTTP `Host` header. DNS, SSRF, private-IP, HTTPS, and egress-policy network checks do not apply to the synthetic URL host because no TCP connection is made. Treat the socket path as privileged configuration and never derive it from user input.

HTTP/2, proxy config, and HTTPS URLs are rejected with `socketPath`; use the Node HTTP/1.1 adapter for local sockets.

## Local Proxy

Use explicit `proxy` config when traffic must pass through a local or enterprise gateway:

```ts
const api = neutrx.create({
  baseURL: 'https://inventory.internal.example',
  proxy: {
    host: '127.0.0.1',
    port: 8080,
    auth: {
      username: process.env.PROXY_USER ?? '',
      password: process.env.PROXY_PASSWORD ?? '',
    },
  },
  security: {
    profile: 'standard',
    allowedHosts: ['inventory.internal.example'],
  },
});
```

Set `proxy: false` to bypass explicit or environment proxy settings for a client. `socketPath` and `proxy` cannot be combined because they represent different transports.

## beforeRedirect

`beforeRedirect` runs after Neutrx validates the redirect target, strips unsafe headers, and prepares the next hop:

```ts
const api = neutrx.create({
  baseURL: 'https://api.example.com',
  beforeRedirect(context) {
    context.headers['X-Redirect-Checked'] = 'neutrx';
    console.log(context.statusCode, context.fromURL, context.toURL);
  },
});
```

Header mutations affect the next redirected request. Redirects still go through Neutrx policy, including HTTPS downgrade blocking, SSRF checks, egress policy, and credential stripping.
The hook may add safe per-hop headers, but it cannot restore sensitive or body-specific headers that Neutrx strips for a cross-origin or method-changing redirect.

## decompress

`decompress` defaults to `true` for buffered Node responses and supports gzip, deflate, and brotli:

```ts
const decoded = await api.get('/report.json');
```

Set `decompress: false` when middleware, storage, or audit systems need the compressed wire bytes:

```ts
const compressed = await api.get<Buffer>('/report.json.gz', {
  responseType: 'buffer',
  decompress: false,
});
```

`maxContentLength` is enforced before buffering and again after decompression when Neutrx can inspect the inflated bytes.

## responseEncoding

`responseEncoding` controls buffered text and JSON decoding in Node:

```ts
const legacy = await api.get<string>('/legacy-feed', {
  responseType: 'text',
  responseEncoding: 'latin1',
});
```

Use `responseType: 'buffer'` when you need exact bytes. Browser builds use platform decoding behavior and should not rely on Node-only encodings.

## allowAbsoluteUrls

`allowAbsoluteUrls` defaults to `true`, matching Axios-style behavior where absolute request URLs replace `baseURL`. Set it to `false` when all calls must remain pinned to a configured base URL or service-discovery endpoint:

```ts
const pinned = neutrx.create({
  baseURL: 'https://egress-gateway.internal/proxy',
  allowAbsoluteUrls: false,
});

await pinned.get('https://vendor.example/orders');
// Final URL: https://egress-gateway.internal/proxy/https://vendor.example/orders
```

This is useful for egress gateway patterns where the apparent upstream URL is part of the gateway path.

## clarified timeout errors

Neutrx exposes typed timeout errors with a `phase` and `timeout` in `toJSON()`:

```ts
try {
  await api.get('/slow', {
    timeout: 2_000,
    transitional: { clarifyTimeoutError: true },
  });
} catch (error) {
  if (neutrx.isNeutrxError(error)) {
    console.error(error.code, error.toJSON());
  }
}
```

For Axios migration compatibility, `transitional.clarifyTimeoutError: false` uses `ECONNABORTED`. Set it to `true` to use `ETIMEDOUT`. The typed error still includes the timeout phase, such as `connect` or `response`.

## maxRate

`maxRate` caps Node HTTP bandwidth in bytes per second:

```ts
await api.get('/exports/monthly.csv', {
  responseType: 'buffer',
  maxRate: [0, 256 * 1024],
  onDownloadProgress(event) {
    console.log(event.loaded, event.total, event.rate, event.estimated);
  },
});
```

Pass a number to cap upload and download equally, or `[uploadBytesPerSecond, downloadBytesPerSecond]` to control each direction. Use `0` for a direction you do not want to cap. HTTP/2 and browser fetch do not support `maxRate`; use `adapter: 'http'` when bandwidth shaping is required.

`security.rateLimit` and `maxRate` solve different problems: rate limiting controls request count over a time window, while `maxRate` controls byte throughput for one request.

## Utility Methods

Operational clients can be prepared and inspected without reaching into internals:

```ts
const api = neutrx.create({ baseURL: 'https://api.example.com' })
  .setTimeout(10_000)
  .setHeader('X-Service', 'billing')
  .setAuth({ bearer: process.env.API_TOKEN ?? '' });

const url = api.getUri({ url: '/users', params: { page: 1 } });
const metrics = api.getMetrics();
const cache = api.getCacheStats();
const bulkhead = api.getBulkheadStats();
const egress = api.getEgressPolicy();

api.removeHeader('X-Service').clearAuth();
```

Useful methods include `setBaseURL`, `setTimeout`, `setHeader`, `removeHeader`, `setAuth`, `clearAuth`, `getUri`, `getMetrics`, `getMetricsPrometheus`, `getCacheStats`, `getCircuitStatus`, `getBulkheadStats`, `getEgressPolicy`, `clearCache`, `invalidateCache`, `deleteCacheEntry`, and `destroy`.

Call `destroy()` when an infrastructure worker is shutting down and you want to close keep-alive agents, HTTP/2 sessions, cache timers, metrics timers, and event listeners.

