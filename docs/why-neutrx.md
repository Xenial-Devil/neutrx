# Why Neutrx

Neutrx is for Node.js backend egress where outbound HTTP is a security boundary.

It is not a general claim that Neutrx is better than Axios. Axios is broader, older, and stronger for mixed browser and Node.js applications. Neutrx is a better fit when a backend service needs secure defaults around user-influenced URLs, internal service calls, retries, typed errors, and observability.

## Choose Neutrx When

- You run Node.js 18+ backend services.
- Requests may be influenced by users, webhooks, partners, or integrations.
- SSRF, cloud metadata access, redirect credential leaks, and secret logging are real risks.
- You want retries, circuit breaker, bulkhead isolation, schema validation, safe structured errors, Prometheus metrics, W3C/B3 propagation, and an OpenTelemetry client-span bridge in one client.
- You want zero required runtime dependencies in core.

## Keep Axios Or Native Fetch When

- Browser support is the main product surface.
- React Native, Bun, Deno, or older Node versions are required.
- You depend heavily on Axios-specific community adapters or deprecated APIs beyond the small `CancelToken` migration bridge.
- You need a general-purpose client more than a backend egress policy layer.

## Comparison

| Client | Best fit | Notes |
| --- | --- | --- |
| Axios | Broad browser and Node.js compatibility | Huge ecosystem, mature docs, many migration habits |
| Native fetch/Undici | Minimal modern HTTP | Great baseline, but security and resilience policy stay in userland |
| Got | Node.js convenience and rich options | Mature Node client, not zero-dependency core |
| Ky | Browser-first fetch ergonomics | Useful for frontend fetch wrappers |
| Neutrx | Secure Node.js backend service-to-service HTTP | SSRF checks, redirect safety, egress policy, redacted typed errors, resilience, metrics |

## Neutrx Promise

Axios-like ergonomics for Node.js backends, with SSRF protection, redirect safety, redacted typed errors, retries, circuit breaking, cache metrics, and observability built in.
