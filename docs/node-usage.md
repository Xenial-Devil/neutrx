# Node Usage

Neutrx is backend-first. The Node entry uses the built-in Node HTTP adapter by default and can use HTTP/2, Unix sockets, custom agents, proxy config, TLS controls, DNS lookup hooks, bandwidth rate limits, progress events, and strict SSRF checks.

## Standard Service Client

```ts
import neutrx from 'neutrx';

export const billingApi = neutrx.create({
  baseURL: 'https://billing.example.com',
  timeout: 8_000,
  connectTimeout: 2_000,
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
```

Use `allowedHosts` when the service has a fixed upstream host. Use `egressPolicy` when the allowed outbound shape should be audited.

## HTTP/2

```ts
const api = neutrx.create({
  baseURL: 'https://api.example.com',
  httpVersion: 2,
  http2Options: {
    sessionTimeout: 60_000,
    maxSessions: 50,
    maxConcurrentStreams: 100,
  },
});
```

HTTP/2 does not support proxy config, `socketPath`, custom HTTP agents, or `maxRate`. Use `adapter: 'http'` or `httpVersion: 1` when those controls are required.

## TLS And Certificate Pins

```ts
const payments = neutrx.create({
  baseURL: 'https://payments.example.com',
  security: { profile: 'strict' },
  tls: {
    ca: process.env.PAYMENTS_CA_PEM,
    cert: process.env.PAYMENTS_CLIENT_CERT_PEM,
    key: process.env.PAYMENTS_CLIENT_KEY_PEM,
    servername: 'payments.example.com',
    certificatePins: [{
      hostname: 'payments.example.com',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }],
  },
});
```

## Unix Socket Request

```ts
const docker = neutrx.create({
  baseURL: 'http://docker',
  socketPath: '/var/run/docker.sock',
  proxy: false,
});

const version = await docker.get('/v1/version');
```

Treat `socketPath` as privileged local configuration. It should not come from user-controlled input.

## Progress And Bandwidth Limits

```ts
await api.get('/exports/monthly.csv', {
  responseType: 'buffer',
  maxRate: [0, 256 * 1024],
  onDownloadProgress(event) {
    console.log(event.loaded, event.total, event.rate);
  },
});
```

`security.rateLimit` controls request counts. `maxRate` controls Node HTTP upload and download bytes per second.

## Node Reference

- [Config reference](config-reference.md)
- [Secure egress](secure-egress.md)
- [Adapter security contract](adapter-security-contract.md)
- [Backend recipes](recipes/backend-recipes.md)
