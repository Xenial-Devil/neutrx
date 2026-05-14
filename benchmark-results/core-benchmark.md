# Core Public API Benchmark

Generated: 2026-05-14T06:49:05.271Z
Node: v25.8.2
Benchmark harness: node:perf_hooks

- Benchmarks public client creation, URL building, headers, mock plugin, cache hit, custom adapter request pipeline.
- Network is bypassed except adapter parsing, so results isolate module overhead.

| Scenario | Category | Input | Ops/sec | Avg ms/op | Min ms/op | Max ms/op | Heap delta | Iterations |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create README-style client | client | small | 74,201.1 | 0.0135 | 0.0085 | 0.0465 | 33.3 KiB | 1000 |
| getUri with small params | url | 5 params | 314,445.72 | 0.0032 | 0.0025 | 0.0080 | -3.2 KiB | 220 |
| getUri with medium params | url | 100 params | 32,300.01 | 0.0310 | 0.0265 | 0.0691 | -920 B | 227 |
| NeutrxHeaders concat normalize redact | headers | 100 headers | 15,940.71 | 0.0627 | 0.0509 | 0.0929 | 2.0 KiB | 112 |
| GET through custom adapter | request | small | 4,007.03 | 0.2496 | 0.1337 | 0.8348 | -9.7 KiB | 2798 |
| POST transforms and interceptors | request | small json | 4,230.02 | 0.2364 | 0.1220 | 0.7619 | 56.3 KiB | 2953 |
| MockPlugin matched GET | plugin | small | 102,281.49 | 0.0098 | 0.0067 | 0.4249 | 64.5 KiB | 5000 |
| GET cache hit | cache | small | 37,105.5 | 0.0270 | 0.0203 | 0.7093 | 46.0 KiB | 5000 |
