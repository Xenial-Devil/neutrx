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

A starter Grafana dashboard is available at [grafana-dashboard.json](grafana-dashboard.json). Import it into Grafana and point panels at the Prometheus data source scraping `api.getMetricsPrometheus()`.

## Events

```ts
api.on('request:success', event => console.log(event.status, event.duration));
api.on('request:error', event => console.error(event.error.code));
api.on('cache:hit', event => console.log(event.url));
```

## Structured Logging

```ts
import neutrx, { LogPlugin } from 'neutrx';

const api = neutrx.create({ baseURL: 'https://api.example.com' });
api.use(LogPlugin);
api.setLogger(console);
```

`LogPlugin` emits redaction-friendly fields such as request id, method, URL, status, duration, attempt count, cache state, error code, and error name. It accepts console-like, pino-like, or winston-like loggers with `info` and `error` methods.

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

Or enable the same bridge through a plugin:

```ts
import neutrx, { createOtelPlugin } from 'neutrx';

const api = neutrx.create({ baseURL: 'https://api.example.com' });
api.use(createOtelPlugin({ tracerName: 'billing-http' }));
```

Span attributes include method, scheme, host, port, path target without query string, status code, retry count, cache hit or miss, request duration, and circuit breaker state.

Neutrx follows OpenTelemetry HTTP client semantic attribute names where they can be emitted safely:

- `http.request.method`
- `http.target`
- `url.scheme`
- `url.path`
- `server.address`
- `server.port`
- `network.protocol.name`
- `network.protocol.version`
- `http.response.status_code`
- `error.type`

It does not emit `url.full` or raw query strings because tokens and user data often live there. Neutrx-specific attributes use the `neutrx.*` namespace for retry count, cache state, duration, circuit breaker state, request id, idempotency-key presence, and selected service-discovery endpoint metadata.

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
