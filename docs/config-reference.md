# Config Reference

Neutrx config precedence is:

1. library defaults
2. instance defaults from `neutrx.create()`
3. per-request config

## Core

```ts
const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  connectTimeout: 2_000,
  maxRedirects: 5,
  maxContentLength: 52_428_800,
  maxBodyLength: 10_485_760,
  maxRate: [64 * 1024, 256 * 1024],
  parseJson: text => JSON.parse(text),
  stringifyJson: value => JSON.stringify(value),
  throwHttpErrors: true,
});
```

`legacy` keeps request body size unlimited unless you set `maxBodyLength`. `strict` and `standard` use a finite default.

`neutrx.defaults` is mutable and merges into new root requests and new instances. Instance config and per-request config override it. Headers are cloned and normalized during merges.

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

## Request

```ts
await api.get('/users', {
  params: { page: 1 },
  paramsSerializer: params => new URLSearchParams(params as Record<string, string>).toString(),
  signal: AbortSignal.timeout(2_000),
  validateStatus: status => status < 500,
  throwHttpErrors: false,
});
```

Node-only request fields:

- `socketPath`: Unix domain socket path for HTTP requests.
- `decompress`: defaults to `true`; set `false` to keep gzip/deflate/br bytes compressed.
- `maxRate`: bytes per second for both directions, or `[uploadBytesPerSec, downloadBytesPerSec]`.
- `httpAgent`, `httpsAgent`, and `lookup`: Node transport customization.

Adapter fields:

- `adapter: 'http'`: Node HTTP/HTTPS adapter.
- `adapter: 'fetch'`: native `globalThis.fetch`.
- `adapter: 'http2'`: HTTP/2 adapter.
- `adapter: config => RawHttpResponse`: custom adapter.

## Resilience

```ts
resilience: {
  enableRetry: true,
  maxRetries: 3,
  retryMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
  enableCircuitBreaker: true,
  failureThreshold: 5,
  enableBulkhead: true,
  maxConcurrent: 10,
}
```

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
}
```

`deduplicateRequests` shares identical inflight `GET`/`HEAD` dispatches. `stale-while-revalidate` returns stale cache hits until `cacheStaleMax` while one background refresh updates the entry.

## Instrumentation

```ts
instrumentation: {
  openTelemetry: true,
  tracerName: 'neutrx',
  propagateTraceHeaders: true,
}
```
