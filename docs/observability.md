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
