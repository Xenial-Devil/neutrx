---
title: Legacy HTTP Client Migration
parent: Migration
nav_order: 2
---

# Legacy HTTP Client Migration

Neutrx keeps an ergonomic request API while focusing on secure Node.js 18+ backend service calls. This guide highlights common migration patterns from another HTTP client or legacy request library.

## Common Patterns

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  security: { profile: 'standard' },
});

await api.get('/users', { params: { page: 1 } });
await api.post('/users', { name: 'Ada' });
await api.put('/users/1', { name: 'Ada' });
await api.patch('/users/1', { name: 'Ada Lovelace' });
await api.delete('/users/1');
await api.head('/health');
await api.options('/health');
```

Supported migration pieces:

- `neutrx.create()`
- Verb helpers: `get`, `post`, `put`, `patch`, `delete`, `head`, and `options`
- `baseURL` plus relative request URLs
- Request `timeout` and `AbortController` cancellation
- `params` and `paramsSerializer`
- Request and response interceptors with `use`, `eject`, and `clear`
- `validateStatus`
- `transformRequest` and `transformResponse`
- `getUri()`
- Config precedence: library defaults, then instance defaults, then request config

## Intentional Differences

- Node.js >=18.
- Default security profile is `standard`.
- `strict` and `standard` block private/internal targets and metadata endpoints.
- `legacy` is for trusted migrations and local testing only.
- Deprecated profile aliases may be accepted for compatibility but should be replaced.
- URLs with embedded credentials are blocked by `strict` and `standard`; use `Authorization` headers instead.
- Cross-origin redirects strip credentials and sensitive custom headers.
- Retries default to idempotent methods only.
- Errors are Neutrx errors. Use `isNeutrxError()` and typed error classes for handling.

## Interceptors

```ts
const id = api.interceptors.request.use(config => ({
  ...config,
  headers: { ...config.headers, 'X-Service': 'billing' },
}), undefined, {
  runWhen: config => config.method === 'GET',
});

api.interceptors.request.eject(id);
api.interceptors.request.clear();
api.interceptors.response.clear();
```

Keep interceptors small. Prefer built-in retry, circuit breaker, cache, and metrics instead of reimplementing those concerns in interceptors.

## Errors

```ts
import { isNeutrxError, NeutrxHTTPError } from 'neutrx';

try {
  await api.get('/users');
} catch (error) {
  if (!isNeutrxError(error)) throw error;
  console.error(error.code, error.toJSON());
  if (error instanceof NeutrxHTTPError) {
    console.error(error.status, error.response.headers);
  }
}
```

`toJSON()` redacts URLs, headers, response data, and context fields that look like tokens, cookies, API keys, passwords, or secrets.

## Migration Profile

```ts
const api = neutrx.create({
  baseURL: 'http://127.0.0.1:3000',
  security: { profile: 'legacy', blockMetadataIPs: true },
});
```

Move clients from `legacy` to `standard` or `strict` after the upstream target and redirects are known safe.
