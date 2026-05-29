# Roadmap

See [docs/improvement-checklist.md](docs/improvement-checklist.md) for the gap-analysis checklist and adoption-blocker status.

Near-term follow-up candidates after the release-blocking Axios-parity pass:

- HTTP/2 session reuse tuning and pool observability.
- `AbortSignal.timeout` and `AbortSignal.any` convenience wiring.
- Retry budget refinements across instances and processes.
- First-party OpenTelemetry plugin package.
- Managed connection pool controls.
- DoH resolver plugin.
- AsyncIterator streaming helpers.

Recently completed:

- MIT licensing, ESM/CJS/browser exports, fetch adapter, HTTP/2 adapter, and package smoke checks.
- Mutable `neutrx.defaults`, `NeutrxHeaders`, interceptor `runWhen`/`synchronous`, typed error guard, and error `toJSON()`.
- Form and URL-encoded body serialization, `socketPath`, enhanced progress events, and request deduplication.
- Built-in WebSocket, structured logging, and OpenTelemetry plugins.
- Stale-while-revalidate cache support, cache metrics, and Grafana starter dashboard.
- Browser entry tests plus 90%+ line/function coverage.
