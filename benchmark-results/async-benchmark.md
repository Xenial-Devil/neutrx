# Async Workflow Benchmark

Generated: 2026-05-14T06:49:23.410Z
Node: v25.8.2
Benchmark harness: node:perf_hooks

- Benchmarks public concurrency helpers, pagination, GraphQL plugin, and cached OAuth2 hook.
- Uses custom adapters/fetch to avoid external network variability.

| Scenario | Category | Input | Ops/sec | Avg ms/op | Min ms/op | Max ms/op | Heap delta | Iterations |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| concurrent 25 GET limit 5 | concurrent | 25 req | 117.71 | 8.496 | 4.253 | 19.293 | 60.7 KiB | 107 |
| sequential 25 GET | async | 25 req | 57.25 | 17.467 | 13.157 | 27.418 | -41.1 KiB | 52 |
| race 5 GET | async | 5 req | 259.51 | 3.853 | 2.999 | 5.898 | 38.2 KiB | 182 |
| hedged 5 GET delay 0 | async | 5 req | 958.8 | 1.043 | 0.7809 | 2.806 | 6.77 MiB | 671 |
| paginate 10 pages | pagination | 10 pages | 315.33 | 3.171 | 1.804 | 6.313 | 6.1 KiB | 284 |
| GraphQLPlugin gql request | plugin | small | 3,110.03 | 0.3215 | 0.2009 | 1.091 | 246.5 KiB | 2172 |
| OAuth2Plugin cached token GET | plugin | small | 1,856.53 | 0.5386 | 0.3727 | 1.470 | 51.0 KiB | 1297 |
