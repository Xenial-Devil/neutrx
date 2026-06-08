# Neutrx Documentation

Neutrx is a security-first HTTP client for Node.js 18+ backend services. It keeps Axios-like request ergonomics, then adds backend controls for SSRF protection, redirect safety, retries, circuit breaking, bulkhead isolation, cache metrics, typed redacted errors, and OpenTelemetry-friendly hooks.

Use these docs to get a production service client running quickly, migrate Axios code safely, and tune security and resilience behavior without adding runtime dependencies to Neutrx core.

## Start Here

- [Getting started](getting-started.md): install Neutrx and make your first client.
- [Axios migration guide](axios-migration.md): move common Axios patterns to Neutrx in one pass.
- [Full-stack and frontend migration](full-stack-frontend-migration.md): compare browser/server adapter behavior, fetch support, defaults, headers, interceptors, progress events, and Axios workflow mappings.
- [Node infrastructure usage](node-infrastructure.md): configure Docker sockets, local proxies, redirects, decompression, encodings, timeout diagnostics, bandwidth caps, and operational utility methods.
- [Security features](security-features.md): understand profiles, SSRF controls, redirect policy, egress policy, and redacted errors.
- [API reference](api.md): find request config, response shapes, adapters, plugins, errors, and utility methods.
- [Support and sustainability](support.md): find public support, private security reporting, and sponsorship paths.

## Common Paths

| Goal | Read |
| --- | --- |
| Build a Node service client | [Node usage](node-usage.md) |
| Use Docker sockets, local proxies, or enterprise egress controls | [Node infrastructure usage](node-infrastructure.md) |
| Use browser bundlers with platform limits | [Browser usage](browser-usage.md) |
| Share Axios-like client workflows across browser and backend code | [Full-stack and frontend migration](full-stack-frontend-migration.md) |
| Add retries without retry storms | [Retry strategies](retries.md) |
| Fail fast during upstream incidents | [Circuit breaker](circuit-breaker.md) |
| Cap concurrency per origin | [Bulkhead isolation](bulkhead-isolation.md) |
| Add tracing, logging, validation, mocks, or GraphQL | [Plugins](plugins.md) |

## Example Library

- [REST API request](examples/rest-api-request.md)
- [Auth token](examples/auth-token.md)
- [File upload](examples/file-upload.md)
- [Request retry](examples/request-retry.md)
- [OTel tracing](examples/otel-tracing.md)
- [Schema validation](examples/schema-validation.md)
- [Docker socket request](examples/docker-socket-request.md)
