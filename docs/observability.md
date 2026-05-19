# Observability

Neutrx exposes lightweight metrics and events without requiring OpenTelemetry as a runtime dependency.

## Metrics

```ts
const snapshot = api.getMetrics();

console.log(snapshot.requests.active);
console.log(snapshot.requests.retried);
console.log(snapshot.errors.byCode);
console.log(snapshot.byStatus);
```

Tracked signals:

- total, active, success, error, cached, and retried request counts
- duration min, max, average, and percentiles
- status code counts
- error type and code counts
- endpoint metrics using host plus path, without query strings

Prometheus text is available through `api.getMetricsPrometheus()`.

## Events

```ts
api.on('request:success', event => console.log(event.status, event.duration));
api.on('request:error', event => console.error(event.error.code));
api.on('cache:hit', event => console.log(event.url));
```

## OpenTelemetry Bridge

OpenTelemetry is optional. If `@opentelemetry/api` is installed by the application, Neutrx can use it. Tests can also inject `globalThis.__NEUTRX_OTEL_API__`.

```ts
const api = neutrx.create({
  instrumentation: {
    openTelemetry: true,
    tracerName: 'billing-http',
    propagateTraceHeaders: true,
  },
});
```

Span attributes include method, scheme, host, port, path without query string, status code, retry count, and cache hit state.

Neutrx follows OpenTelemetry HTTP client semantic attribute names where they can be emitted safely:

- `http.request.method`
- `url.scheme`
- `url.path`
- `server.address`
- `server.port`
- `network.protocol.name`
- `network.protocol.version`
- `http.response.status_code`
- `error.type`

It does not emit `url.full` or raw query strings because tokens and user data often live there. Neutrx-specific attributes use the `neutrx.*` namespace for retry count, cache state, request id, idempotency-key presence, and selected service-discovery endpoint metadata.

Body sizes are opt-in:

```ts
const api = neutrx.create({
  instrumentation: {
    openTelemetry: true,
    recordRequestBodySize: true,
    recordResponseBodySize: true,
  },
});
```

Only known sizes are recorded from `Content-Length` or already-buffered/string bodies. Streams are not consumed for telemetry.
