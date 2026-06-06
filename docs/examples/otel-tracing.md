# OTel Tracing

Neutrx can create OpenTelemetry-friendly spans and propagation headers when the application installs `@opentelemetry/api`. Neutrx core does not require it as a runtime dependency.

```ts
import neutrx, { createOtelPlugin, createTraceContextPlugin } from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  security: { profile: 'standard' },
});

api.use(createOtelPlugin({
  tracerName: 'billing-http',
  propagateTraceHeaders: true,
}));

api.use(createTraceContextPlugin({
  formats: ['w3c', 'b3-multi', 'b3-single'],
  sampled: true,
}));

export async function fetchHealth(): Promise<number> {
  const response = await api.get('/health');
  console.log(response.traceContext);
  console.log(api.getMetrics());
  return response.status;
}
```

The OTel carrier is injected from the client span created for the request. Additional B3 headers reuse the same identity, retry attempts are span events, and `response.traceContext` exposes the trace and span IDs for correlation. Span attributes avoid raw query strings and use safe request details such as method, path target, host, retry count, status, cache state, duration, and circuit breaker state.
