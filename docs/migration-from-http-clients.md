# Migrating From Other HTTP Clients

This document provides a short migration reference for users moving to Neutrx from another HTTP client or from legacy request libraries. For the full guide, see [../MIGRATION_GUIDE.md](../MIGRATION_GUIDE.md).

## Common Replacements

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  security: { profile: 'standard' },
});

await api.get('/users');
await api.post('/users', { name: 'Ada' });
await api.postForm('/upload', { name: 'report', file: new Blob(['ok']) });
```

## Interceptors

```ts
const id = api.interceptors.request.use(config => ({
  ...config,
  headers: { ...config.headers, 'X-App': 'billing' },
}), undefined, {
  runWhen: config => config.method === 'GET',
});

api.interceptors.request.eject(id);
api.interceptors.response.clear();
```

## Params And Transforms

```ts
const api = neutrx.create({
  paramsSerializer: params => new URLSearchParams(params as Record<string, string>).toString(),
  transformRequest(data, headers) {
    headers['X-Transformed'] = 'yes';
    return data;
  },
  transformResponse(data) {
    return data;
  },
});
```

## Main Differences

| Previous pattern | Neutrx behavior |
| --- | --- |
| Broad runtime compatibility | Node.js >=22 only; browser entry is secondary |
| Retrying unsafe methods by default | Retries idempotent methods by default |
| Local addresses allowed by default | Blocked by stronger SSRF profiles |
| Raw error serialization | `NeutrxError.toJSON()` redacts secrets |
| Client-managed backend safeguards | Backend security defaults |

## Migration Profile

Use `legacy` only for trusted migration targets:

```ts
const api = neutrx.create({
  security: { profile: 'legacy' },
});
```

For untrusted URLs, use `strict` with `allowedHosts`.
