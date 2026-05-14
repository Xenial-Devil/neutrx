# Node API Benchmark Report

Date: 2026-05-14
Package: neutrx
Node: v25.8.2
Benchmark harness: custom `node:perf_hooks`
Command: `npm run benchmark`

## Tool Choice

No existing `tinybench` or `benchmark.js` dependency was present. A small `node:perf_hooks` harness was used to keep the benchmark suite offline-friendly, dependency-free, and able to measure async workflows plus heap delta with `--expose-gc`.

## Files Created Or Updated

- `benchmarks/runner.js`
- `benchmarks/fixtures/payloads.js`
- `benchmarks/core.bench.js`
- `benchmarks/large-input.bench.js`
- `benchmarks/async.bench.js`
- `package.json`
- `src/core/NeutrxClient.ts`
- `benchmark-results/core-benchmark.md`
- `benchmark-results/large-input-benchmark.md`
- `benchmark-results/async-benchmark.md`
- `benchmark-results/node-api-benchmark-report.md`

## Workflows Benchmarked

- Public client creation and README-style configuration.
- `getUri` URL and query-string generation.
- `NeutrxHeaders` normalization, merging, and redaction.
- Public request pipeline with custom adapter.
- Request transforms and interceptors.
- `MockPlugin`, `GraphQLPlugin`, and cached `OAuth2Plugin`.
- GET cache hit path.
- Large query params, JSON request bodies, URL-encoded serialization, large JSON parsing, nested sanitization, and 1 MiB buffer body.
- Local loopback HTTP POST path for Node adapter serialization behavior.
- `concurrent`, `sequential`, `race`, `hedged`, and `paginate`.

## Input Sizes

- Empty object.
- Small: 5 query params, small JSON payload.
- Medium: 100 query params, about 64 KiB JSON payload, 500-item serializer payload.
- Large: 1000 query params, about 512 KiB JSON payload/response.
- Memory-heavy: 1 MiB buffer body.
- Worst-case safe nested input: depth 9 JSON object.
- Async batches: 5, 10, and 25 request workflows.

## Core Results

| Scenario | Input | Ops/sec | Avg ms/op | Heap delta |
| --- | --- | ---: | ---: | ---: |
| create README-style client | small | 74,201.1 | 0.0135 | 33.3 KiB |
| getUri with small params | 5 params | 314,445.72 | 0.0032 | -3.2 KiB |
| getUri with medium params | 100 params | 32,300.01 | 0.0310 | -920 B |
| NeutrxHeaders concat normalize redact | 100 headers | 15,940.71 | 0.0627 | 2.0 KiB |
| GET through custom adapter | small | 4,007.03 | 0.2496 | -9.7 KiB |
| POST transforms and interceptors | small json | 4,230.02 | 0.2364 | 56.3 KiB |
| MockPlugin matched GET | small | 102,281.49 | 0.0098 | 64.5 KiB |
| GET cache hit | small | 37,105.5 | 0.0270 | 46.0 KiB |

## Large Input Results

| Scenario | Input | Ops/sec | Avg ms/op | Heap delta |
| --- | --- | ---: | ---: | ---: |
| getUri large query params | 1000 params | 636.07 | 1.572 | 19.3 KiB |
| fetch adapter POST empty object | empty | 2,403.9 | 0.4160 | 502.9 KiB |
| fetch adapter POST small JSON | ~1 KiB | 1,657.34 | 0.6034 | 75.1 KiB |
| fetch adapter POST medium JSON | ~64 KiB | 533.72 | 1.874 | -48.4 KiB |
| fetch adapter POST large JSON | ~512 KiB | 169.04 | 5.916 | -2.2 KiB |
| HTTP adapter POST medium JSON | ~64 KiB | 327.6 | 3.053 | 402.7 KiB |
| serialize urlencoded medium object | 500 items | 911.64 | 1.097 | 39.0 KiB |
| parse large JSON buffer | ~512 KiB | 51.2 | 19.533 | -1.1 KiB |
| sanitize nested worst-case POST | depth 9 | 1,283.93 | 0.7789 | 68.8 KiB |
| fetch adapter POST 1 MiB buffer | 1 MiB | 1,149.73 | 0.8698 | 51.4 KiB |

## Async Results

| Scenario | Input | Ops/sec | Avg ms/op | Heap delta |
| --- | --- | ---: | ---: | ---: |
| concurrent 25 GET limit 5 | 25 req | 117.71 | 8.496 | 60.7 KiB |
| sequential 25 GET | 25 req | 57.25 | 17.467 | -41.1 KiB |
| race 5 GET | 5 req | 259.51 | 3.853 | 38.2 KiB |
| hedged 5 GET delay 0 | 5 req | 958.8 | 1.043 | 6.77 MiB |
| paginate 10 pages | 10 pages | 315.33 | 3.171 | 6.1 KiB |
| GraphQLPlugin gql request | small | 3,110.03 | 0.3215 | 246.5 KiB |
| OAuth2Plugin cached token GET | small | 1,856.53 | 0.5386 | 51.0 KiB |

## Performance Differences

- URL generation drops from 314,445.72 ops/sec at 5 params to 636.07 ops/sec at 1000 params. Large query construction is roughly 494x slower than small query construction.
- Fetch POST drops from 2,403.9 ops/sec for an empty body to 169.04 ops/sec for a ~512 KiB JSON body. Large JSON request handling is roughly 14x slower than empty-body handling.
- Parsing a ~512 KiB JSON buffer is the slowest measured CPU-bound path at 19.533 ms/op.
- `concurrent` with 25 requests and limit 5 is about 2.1x faster than `sequential` for the same custom-adapter workload.

## Performance Risks Found

- Initial loopback HTTP benchmark exposed `MaxListenersExceededWarning` on reused keep-alive sockets. Root cause: each request added a socket timeout callback via `socket.setTimeout(timeout, callback)`. Fix applied in `src/core/NeutrxClient.ts`: set socket timeout separately, attach a one-shot `timeout` listener, and remove it on request close.
- Large JSON parsing is CPU-bound and scales with response size. This is expected, but consumers moving multi-MiB JSON through the default `json` response path should expect latency.
- `hedged` shows noticeably higher heap delta than other async helpers in this synthetic run. It creates multiple controllers/promises by design; real workloads should tune hedge count and delay.

## Recommended Improvements

- Add CI job for `npm run benchmark` or a shorter smoke benchmark to catch listener leaks and performance regressions.
- Consider a JSON streaming option or documented `responseType: 'stream'` guidance for very large JSON responses.
- Track benchmark JSON artifacts over time and compare ops/sec deltas in release validation.
- Consider a future `tinybench` migration if adding a dev dependency is acceptable; the current harness can stay as a zero-dependency baseline.

## Assumptions

- Benchmarks run against built `dist/esm` output.
- No external network or database calls are made.
- Local HTTP benchmark uses loopback server, so numbers include local socket overhead but not internet latency.
- Heap delta is measured with `--expose-gc`; small deltas may be noisy.
- Existing unit tests were not replaced.

## Verification

- `npm run benchmark`: PASS
- `npm run lint`: PASS
- `npm test`: PASS, 45 passed, 0 failed
