---
title: Plugins
parent: Guides
nav_order: 10
---

# Plugins

Plugins extend client behavior without adding required runtime dependencies to Neutrx core.

```ts
import neutrx, {
  GraphQLPlugin,
  LogPlugin,
  MockPlugin,
  OAuth2Plugin,
  ValidationPlugin,
  createOtelPlugin,
  createTraceContextPlugin,
} from 'neutrx';

const api = neutrx.create({ baseURL: 'https://api.example.com' });
```

## Logging

```ts
api.use(LogPlugin);
api.setLogger(console);
```

`LogPlugin` emits structured request success and error entries with redaction-friendly fields.

## Trace Context

```ts
api.use(createTraceContextPlugin({
  formats: ['w3c', 'b3-multi', 'b3-single'],
  sampled: true,
}));
```

Use this when you want dependency-free propagation headers. Existing trace headers are preserved unless `overwrite: true` is set.

## OpenTelemetry Bridge

```ts
api.use(createOtelPlugin({
  tracerName: 'billing-http',
  propagateTraceHeaders: true,
}));
```

The bridge uses `@opentelemetry/api` when the application installs it. Neutrx itself does not require OpenTelemetry at runtime.

```bash
npm install @opentelemetry/api
```

## Validation

```ts
api.use(ValidationPlugin);

await api.post('/users', { name: 'Ada' }, {
  validation: {
    request: body => body && typeof body === 'object',
    response: {
      safeParse(value) {
        return value && typeof value === 'object' && 'id' in value
          ? { success: true, data: value }
          : { success: false, issues: [{ path: ['id'], message: 'id is required' }] };
      },
    },
  },
});
```

Use the first-class `schema` request option for normal response validation. Use `ValidationPlugin` when you also need request-body validation or shared validation defaults.

## OAuth2

```ts
api.use(OAuth2Plugin);

api.configureOAuth2?.({
  tokenURL: 'https://auth.example.com/token',
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  scope: 'read write',
});
```

The plugin fetches and injects bearer tokens. Use `skipOAuth: true` on token requests that should not use the plugin.

## GraphQL

```ts
api.use(GraphQLPlugin);

const result = await api.gql?.<{ viewer: { id: string } }>(
  '/graphql',
  'query Viewer { viewer { id } }'
);
```

## Mocking

```ts
api.use(MockPlugin);

api.mock?.enable().register('/users', {
  status: 200,
  data: [{ id: 1, name: 'Ada Lovelace' }],
});
```

Use `MockPlugin` for examples, tests, and local demos where you want the client lifecycle without network calls.

## AWS SigV4 (Node only)

```ts
import { createAwsSigV4Plugin } from 'neutrx';

api.use(createAwsSigV4Plugin({
  region: 'us-east-1',
  service: 'execute-api',
  credentials: { accessKeyId: '...', secretAccessKey: '...', sessionToken: '...' },
}));
```

Signs each request via the `beforeRequest` hook using AWS Signature Version 4: canonical request → string-to-sign → HMAC-SHA256 key chain → `Authorization` header. Zero-dep (`node:crypto` only).

- Signs `host`, `content-type` (if present), and all `x-amz-*` headers (including `x-amz-security-token` for STS). `X-Amz-Content-Sha256` is added and signed for `s3` (or opt in via `addContentSha256Header: true`).
- **Body hashing:** strings, `Buffer`, typed arrays, and `URLSearchParams` are hashed directly. Plain objects are serialized to JSON and rewritten onto `config.data` so the wire body matches the signature. Streams, `Blob`, `FormData`, and `unsignedPayload: true` send `UNSIGNED-PAYLOAD`.
- `doubleEncodePath` defaults to `true` except for `s3`. `now` overrides the clock for deterministic tests.

**Server contract:** the target AWS service (or a SigV4-validating gateway) verifies the signature, the credential scope (region/service/date), and the timestamp window. Clock skew beyond ~15 min is rejected by AWS. **Node-only** — needs a `Host` header that `fetch` cannot set.

## HAR Recording

```ts
import { createHarRecorder } from 'neutrx';

const recorder = createHarRecorder({ maxEntries: 1000 });
api.use(recorder.plugin);

// ... make requests ...
const har = recorder.har();        // HAR 1.2 log object
recorder.export();                  // JSON string
recorder.clear();
```

Captures HAR 1.2 entries via `afterRequest`; failed requests are captured via `onError` with status `0` and an `_error` field. Ring-buffer bounded by `maxEntries`. Binary bodies are emitted base64.

**Security default — redaction is on.** `authorization`, `cookie`, `set-cookie`, and `x-amz-security-token` header values are redacted. Pass `redactHeaders: false` to keep raw values, or supply a custom `redactHeaders` list. Treat exported HAR as sensitive: it may still contain URLs, query params, and bodies. `includeRequestBody` / `includeResponseBody` control body capture.
