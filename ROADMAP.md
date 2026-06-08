# Roadmap

Neutrx's original adoption and Axios-migration roadmap is complete in the current repository. The table below preserves the original priority and suggested-release targets while recording the current implementation state.

`Complete` means the feature exists in the current repository with tests or supporting release/docs infrastructure. It does not imply every item is present in the latest published npm tag; changes merged after `v1.3.0` must ship in a later release before users can rely on them from npm.

## Final Recommended Roadmap Table

| Priority | Task | Why it matters | Suggested release | Current status |
| --- | --- | --- | --- | --- |
| P0 | MIT license | Legal adoption | v1.0.0 | Complete |
| P0 | CJS + ESM build | Works in more Node projects | v1.0.0 | Complete |
| P0 | Node >=18 | Wider compatibility | v1.0.0 | Complete |
| P0 | GitHub release + changelog | Trust signal | v1.0.0 | Complete |
| P0 | `SECURITY.md` | Critical for security library | v1.0.0 | Complete |
| P1 | Adapter system | Enables browser, fetch, and HTTP/2 transports | v1.1.0 | Complete |
| P1 | Fetch adapter | Browser and edge support | v1.1.0 | Complete |
| P1 | `NeutrxHeaders` | Spec-compliant headers | v1.1.0 | Complete |
| P1 | `instance.defaults` | Axios migration compatibility | v1.1.0 | Complete |
| P1 | Interceptor options | Axios parity | v1.1.0 | Complete |
| P1 | Rich progress events | Better UI and logging support | v1.1.0 | Complete |
| P1 | `socketPath` | Docker and infrastructure APIs | v1.2.0 | Complete |
| P1 | Missing config options | Axios migration parity for the targeted config set | v1.2.0 | Complete |
| P1 | `maxRate` | Bandwidth throttling | v1.2.0 | Complete |
| P1 | Utility methods | Migration convenience | v1.2.0 | Complete |
| P2 | OTel plugin | Production observability | v1.3.0 | Complete |
| P2 | Response validation | Runtime safety | v1.3.0 | Complete |
| P2 | Trace propagation | Distributed tracing | v1.3.0 | Complete |
| P2 | Request deduplication | Performance moat | v1.4.0 | Complete |
| P2 | SWR cache | Faster cached APIs | v1.4.0 | Complete |
| P2 | HTTP/2 adapter | Modern transport support | v1.4.0 | Complete |
| P3 | WebSocket support | Expanded API surface | v1.4.0+ | Complete |
| P3 | Docs site | Ecosystem growth | v1.4.0+ | Complete |
| P3 | Sponsorship setup | Long-term maintenance | v1.4.0+ | Complete |

See [docs/improvement-checklist.md](docs/improvement-checklist.md) for detailed evidence and remaining adoption work.

## Recommended Next Work

Focus future releases on deepening Neutrx's backend-security advantage instead of adding broad Axios parity:

| Priority | Task | Why it matters |
| --- | --- | --- |
| P0 | Persistent SSRF, redirect, and header-injection fuzz corpus | Proves security claims against parser edge cases and regressions |
| P0 | Trusted publishing verification and provenance badge | Strengthens the release and supply-chain trust story |
| P1 | Multi-process resilience guide and optional Redis package designs | Makes retry budgets, circuits, and cache coordination practical across fleets |
| P1 | HTTP/2 pool observability and session-reuse tuning | Hardens the modern Node transport for production use |
| P1 | Operations recipes for Express, Fastify, and NestJS | Reduces adoption effort for backend teams |
| P2 | OpenAPI typed-client generator design | Improves typed service-to-service developer experience without runtime dependencies |
| P2 | Reproducible public benchmark protocol | Gives users honest performance evidence |
| P2 | AsyncIterator streaming helpers | Improves large-response ergonomics while preserving size and abort controls |
