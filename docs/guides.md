---
title: Guides
description: "Guides for secure Node.js HTTP clients with Neutrx, covering runtime setup, security, resilience, caching, plugins, and observability."
nav_order: 3
has_children: true
---

# Guides

Task-focused guides for building and operating a Neutrx client. Start with [Node Usage](node-usage.md) for a service client, then layer in resilience (retries, circuit breaker, bulkhead), performance (cache, pagination, batching), and extensibility (plugins, observability).

| Topic | What it covers |
| --- | --- |
| [Node Usage](node-usage.md) | Build a backend service client. |
| [Node Infrastructure](node-infrastructure.md) | Docker sockets, proxies, redirects, decompression, bandwidth caps. |
| [Browser Usage](browser-usage.md) | Browser build and its honest platform limits. |
| [Retry Strategies](retries.md) | Backoff, retry budgets, no retry storms. |
| [Circuit Breaker](circuit-breaker.md) | Fail fast during upstream incidents. |
| [Bulkhead Isolation](bulkhead-isolation.md) | Cap concurrency per origin. |
| [Cache & Deduplication](cache.md) | Cache-Control, SWR, in-flight dedupe. |
| [Pagination](pagination.md) | Walk paged endpoints with four strategies. |
| [Request Batching (DataLoader)](data-loader.md) | Collapse N+1 fan-out into one call. |
| [Plugins](plugins.md) | AWS SigV4, HAR, OTel, validation, logging. |
| [Observability](observability.md) | Metrics, tracing, structured errors. |
