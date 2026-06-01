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
