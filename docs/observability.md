---
title: Observability
parent: Guides
nav_order: 11
---

# Observability

Neutrx exposes lightweight metrics and events without requiring OpenTelemetry as a runtime dependency.

## Metrics

```ts
const snapshot = api.getMetrics();

console.log(snapshot.requests.active);
console.log(snapshot.requests.retried);
console.log(snapshot.errors.byCode);
console.log(snapshot.errors.byCategory);
console.log(snapshot.byStatus);
```

Tracked signals:

- total, active, success, error, cached, retried, and deduplicated request counts
- duration min, max, average, and percentiles
- status code counts
- error type, code, and stable category counts
- endpoint metrics using host plus path, without query strings

Prometheus text is available through `api.getMetricsPrometheus()`.

The exporter includes `neutrx_requests_total`, `neutrx_active_requests`, `neutrx_duration_ms`, `neutrx_cache_hits_total`, `neutrx_retries_total`, `neutrx_deduplication_hits_total`, `neutrx_status_total`, `neutrx_errors_by_code_total`, and `neutrx_errors_total{category=...}`. Dynamic label values are escaped before rendering.

A starter Grafana dashboard is available at [grafana-dashboard.json](grafana-dashboard.json). Import it into Grafana and point panels at the Prometheus data source scraping `api.getMetricsPrometheus()`.

## Events

```ts
api.on('request:success', event => console.log(event.status, event.duration));
api.on('request:error', event => console.error(event.error.code));
api.on('cache:hit', event => console.log(event.url));
api.on('request:deduplicated', event => console.log(event.url));
```

## Structured Logging

```ts
import neutrx, { LogPlugin } from 'neutrx';

const api = neutrx.create({ baseURL: 'https://api.example.com' });
api.use(LogPlugin);
api.setLogger(console);
```

`LogPlugin` emits redaction-friendly fields such as request id, trace id, span id, method, query-free URL, status, duration, attempt count, cache state, error category, error code, and error name. It accepts console-like, pino-like, or winston-like loggers with `info` and `error` methods. Error entries use the same redacted representation as `toStructuredError(error)`.

## Trace Context Propagation

Use `TraceContextPlugin` when you want dependency-free distributed tracing headers without requiring OpenTelemetry:

```ts
import neutrx, { createTraceContextPlugin } from 'neutrx';

const api = neutrx.create({ baseURL: 'https://api.example.com' });
api.use(createTraceContextPlugin({
  formats: ['w3c', 'b3-multi', 'b3-single'],
  context: {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    spanId: '00f067aa0ba902b7',
    sampled: true,
    tracestate: 'vendor=value',
  },
}));
```

The default `TraceContextPlugin` emits W3C `traceparent`. Configured formats can include `w3c`, `b3-multi`, and `b3-single`; `b3` is accepted as an alias for the single-header form. The plugin preserves user-supplied `traceparent`, `tracestate`, `X-B3-TraceId`, `X-B3-SpanId`, `X-B3-Sampled`, and `b3` headers unless `overwrite: true` is set.

If OpenTelemetry propagation is also enabled, Neutrx injects the OTel carrier first. `TraceContextPlugin` then reuses that carrier context when generating any additional requested B3 or W3C headers, so formats stay aligned.

The resolved identity is exposed as `response.traceContext`. Typed Neutrx errors also include `traceId` and `spanId` in `error.toJSON()`, including response-schema validation failures.

## OpenTelemetry Bridge

OpenTelemetry is optional. If `@opentelemetry/api` is installed by the application, Neutrx can use it. Tests can also inject `globalThis.__NEUTRX_OTEL_API__`.

```bash
npm install @opentelemetry/api
```

`@opentelemetry/api` is declared as an optional peer dependency. A normal Neutrx install does not install it, and enabling the bridge without it remains a no-op.

```ts
const api = neutrx.create({
  instrumentation: {
    openTelemetry: true,
    tracerName: 'billing-http',
    propagateTraceHeaders: true,
    overwriteTraceHeaders: false,
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

Propagation is injected from the newly created client span, not merely from the previously active parent context. Retry attempts are recorded as `neutrx.request.attempt` span events. Typed failures add `neutrx.error.category`, `neutrx.error.retryable`, and, when available, `neutrx.error.phase`.

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

OpenTelemetry carrier injection preserves existing trace headers by default. Set `overwriteTraceHeaders: true` only when your service should replace caller-provided propagation headers with the active OTel context.
