# Getting Started

## Install

```bash
npm install neutrx
```

Neutrx supports Node.js `>=18.0.0`. The package ships ESM, CommonJS, browser, plugin, error, header, instrumentation, and adapter exports.

## Create A Client

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  security: { profile: 'standard' },
});

const users = await api.get('/users', {
  params: { page: 1 },
});

const created = await api.post('/users', {
  name: 'Ada Lovelace',
});
```

Use one shared client per upstream service when possible. Put service-wide defaults on the client, then override only request-specific fields per call.

## Pick A Security Profile

```ts
const publicApi = neutrx.create({
  baseURL: 'https://api.partner.example',
  security: { profile: 'standard' },
});

const userControlledTargets = neutrx.create({
  security: { profile: 'strict' },
  egressPolicy: { mode: 'webhook-target', allowedPorts: [443] },
});
```

Use `strict` for user-controlled or high-risk outbound URLs. Use `standard` for normal production service-to-service traffic. Use `legacy` only for trusted migrations or local testing.

## Handle Errors Safely

```ts
import { NeutrxHTTPError, isNeutrxError } from 'neutrx';

try {
  await api.get('/users');
} catch (error) {
  if (!isNeutrxError(error)) throw error;

  console.error(error.code, error.toJSON());

  if (error instanceof NeutrxHTTPError) {
    console.error(error.status);
  }
}
```

Prefer `error.toJSON()` for logs. It redacts common secret fields from URLs, headers, response data, and error context.

## Next Steps

- [Axios migration guide](axios-migration.md)
- [Security features](security-features.md)
- [Node usage](node-usage.md)
- [API reference](api.md)
