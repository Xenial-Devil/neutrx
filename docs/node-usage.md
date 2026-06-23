---
title: Node Usage
parent: Guides
nav_order: 1
---

# Node Usage

{: .no_toc }

1. TOC
   {:toc}

---

Neutrx is backend-first. The Node entry uses the built-in Node HTTP/1.1 adapter by default and can use HTTP/2, Unix sockets, custom agents, proxy config, TLS controls, DNS lookup hooks, bandwidth caps, progress events, and strict SSRF checks — all with zero runtime dependencies.

## A standard service client

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
        maxRetries: 3,
        failureThreshold: 5,
        maxConcurrent: 20,
    },
});
```

Use `allowedHosts` when the upstream host is fixed. Use [`egressPolicy`](secure-egress.md) when the allowed outbound shape should be audited.

## Request methods

Every verb is a thin wrapper over `request()`. Bodyless verbs take `(url, config?)`; body verbs take `(url, data, config?)`.

```ts
await api.get('/users', { params: { page: 1 } });
await api.delete('/users/1');
await api.head('/users/1');
await api.options('/users');

await api.post('/users', { name: 'Ada' });
await api.put('/users/1', { name: 'Ada L.' });
await api.patch('/users/1', { name: 'Ada' });

// Content-type convenience variants:
await api.postForm('/upload', formData); // multipart/form-data
await api.postUrlEncoded('/login', { user, pass }); // application/x-www-form-urlencoded
await api.upload('/files', fileData, { onUploadProgress: (e) => {} });
await api.download('/report.pdf'); // -> NeutrxResponse<Buffer>

// Generic form + callable form:
await api.request({ url: '/users', method: 'GET' });
await neutrx('https://api.example.com/health');
```

Type the response with a generic: `await api.get<User>('/users/1')`.

## Concurrency helpers

Built-in helpers run multiple requests without hand-rolling `Promise` orchestration:

```ts
// Run together with a concurrency limit; collect results + errors.
const { results, errors } = await api.concurrent([{ url: '/users' }, { url: '/orders' }, { url: '/inventory' }], {
    limit: 10,
    failFast: false,
});

// Run in order; each step can read the previous result.
await api.sequential([
    { url: '/login', method: 'POST', data: creds },
    (prev) => ({ url: '/me', headers: { authorization: `Bearer ${prev?.data.token}` } }),
]);

// First to resolve wins.
await api.race([{ url: 'https://a.example/ping' }, { url: 'https://b.example/ping' }]);

// Hedged: fire a backup after `delay` ms, take whichever returns first.
await api.hedged([{ url: '/slow' }, { url: '/slow' }], { delay: 200 });
```

For paged endpoints use [`paginate`](pagination.md); for N+1 fan-out use [DataLoader](data-loader.md).

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

HTTP/2 does **not** support proxy config, `socketPath`, custom HTTP agents, or `maxRate`. Use `adapter: 'http'` (or `httpVersion: 1`) when those controls are required.

## TLS and certificate pinning

```ts
const payments = neutrx.create({
    baseURL: 'https://payments.example.com',
    security: { profile: 'strict' },
    tls: {
        ca: process.env.PAYMENTS_CA_PEM,
        cert: process.env.PAYMENTS_CLIENT_CERT_PEM,
        key: process.env.PAYMENTS_CLIENT_KEY_PEM,
        servername: 'payments.example.com',
        certificatePins: [
            {
                hostname: 'payments.example.com',
                sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            },
        ],
    },
});
```

You can also pin at runtime: `api.pinCertificate('host', sha256Hex)`. See [Security Features](security-features.md).

## Unix sockets

```ts
const docker = neutrx.create({
    baseURL: 'http://docker',
    socketPath: '/var/run/docker.sock',
    proxy: false,
});

const version = await docker.get('/v1/version');
```

{: .warning }

> Treat `socketPath` as privileged configuration — never derive it from user input. HTTP/2, proxy config, and HTTPS URLs are rejected with `socketPath`. See [Node Infrastructure](node-infrastructure.md).

## Progress and bandwidth caps

```ts
await api.get('/exports/monthly.csv', {
    responseType: 'buffer',
    maxRate: [0, 256 * 1024], // [upload, download] bytes/sec; 0 = uncapped
    onDownloadProgress: (e) => console.log(e.loaded, e.total, e.rate),
});
```

`security.rateLimit` controls request **counts** over a window; `maxRate` controls **byte throughput** for one request. See [Node Infrastructure → maxRate](node-infrastructure.md).

## Operational methods

```ts
const api = neutrx
    .create({ baseURL: 'https://api.example.com' })
    .setTimeout(10_000)
    .setHeader('X-Service', 'billing')
    .setAuth({ bearer: process.env.API_TOKEN ?? '' });

api.getUri({ url: '/users', params: { page: 1 } }); // resolve final URL
api.getMetrics(); // metrics snapshot
api.getCacheStats();
api.getCircuitStatus();
api.getBulkheadStats();
api.getEgressPolicy();

api.destroy(); // close keep-alive agents, HTTP/2 sessions, cache/metrics timers
```

Call `destroy()` when a worker shuts down to release sockets, sessions, and timers.

## See also

- [Node Infrastructure](node-infrastructure.md) — sockets, proxies, redirects, decompression, bandwidth
- [Config Reference](config-reference.md) · [API Reference](api.md)
- [Secure Egress](secure-egress.md) · [Adapter Security Contract](adapter-security-contract.md)
- [Backend Recipes](recipes/backend-recipes.md)
