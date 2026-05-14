# Large Input Benchmark

Generated: 2026-05-14T06:49:10.659Z
Node: v25.8.2
Benchmark harness: node:perf_hooks

- Uses public API for URL building, fetch adapter requests, and in-process HTTP POST serialization.
- Imports core serializer/parser helpers directly to isolate pure data transformation cost without loopback network overhead.

| Scenario | Category | Input | Ops/sec | Avg ms/op | Min ms/op | Max ms/op | Heap delta | Iterations |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| getUri large query params | url | 1000 params | 636.07 | 1.572 | 1.235 | 2.999 | 19.3 KiB | 25 |
| fetch adapter POST empty object | request | empty | 2,403.9 | 0.4160 | 0.1795 | 2.302 | 502.9 KiB | 1678 |
| fetch adapter POST small JSON | request | ~1 KiB | 1,657.34 | 0.6034 | 0.3671 | 1.388 | 75.1 KiB | 1157 |
| fetch adapter POST medium JSON | request | ~64 KiB | 533.72 | 1.874 | 1.362 | 3.576 | -48.4 KiB | 374 |
| fetch adapter POST large JSON | request | ~512 KiB | 169.04 | 5.916 | 5.039 | 8.209 | -2.2 KiB | 153 |
| HTTP adapter POST medium JSON | network | ~64 KiB | 327.6 | 3.053 | 2.210 | 5.220 | 402.7 KiB | 295 |
| serialize urlencoded medium object | serializer | 500 items | 911.64 | 1.097 | 0.9371 | 2.204 | 39.0 KiB | 638 |
| parse large JSON buffer | parser | ~512 KiB | 51.2 | 19.533 | 16.117 | 29.119 | -1.1 KiB | 80 |
| sanitize nested worst-case POST | security | depth 9 | 1,283.93 | 0.7789 | 0.4887 | 1.685 | 68.8 KiB | 897 |
| fetch adapter POST 1 MiB buffer | memory | 1 MiB | 1,149.73 | 0.8698 | 0.5670 | 2.310 | 51.4 KiB | 1034 |
