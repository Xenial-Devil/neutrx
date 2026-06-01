# Migrating From Other HTTP Clients

This document provides a short migration reference for users moving to Neutrx from another HTTP client or from legacy request libraries. For the full docs-site guide, see [axios-migration.md](axios-migration.md).

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
api.interceptors.request.clear();
api.interceptors.response.clear();
```

## Params And Transforms

```ts
const api = neutrx.create({
  paramsSerializer: params => new URLSearchParams(params as Record<string, string>).toString(),
  parseJson: text => JSON.parse(text),
  stringifyJson: value => JSON.stringify(value),
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
| Broad runtime compatibility | Node.js >=18; browser entry is secondary |
| Retrying unsafe methods by default | Retries idempotent methods by default |
| Local addresses allowed by default | Blocked by stronger SSRF profiles |
| Raw error serialization | `NeutrxError.toJSON()` redacts secrets |
| Client-managed backend safeguards | Backend security defaults |
| `throwHttpErrors: false` in Fetch-style clients | Supported per instance or request |
| Duplicate concurrent `GET`s | Optional `performance.deduplicateRequests` shares inflight dispatches |

## Migration Profile

Use `legacy` only for trusted migration targets:

```ts
const api = neutrx.create({
  security: { profile: 'legacy' },
});
```

For untrusted URLs, use `strict` with `allowedHosts`.
