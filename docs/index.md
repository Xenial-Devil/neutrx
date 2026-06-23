---
title: Home
nav_order: 1
---

<div class="hero">
  <span class="hero-eyebrow">🛡️ Secure by default · Zero runtime deps</span>
  <h1 class="hero-title hero-title--logo">
    <img class="hero-logo" src="{{ '/assets/neutrx-logo.svg' | relative_url }}" alt="Neutrx">
  </h1>
  <p class="hero-tagline">Security-first, zero-runtime-dependency TypeScript HTTP client for Node.js 18+ backends — Axios-like ergonomics with SSRF protection, redirect safety, resilience, and typed redacted errors.</p>
  <div class="hero-actions">
    <a class="btn btn-primary" href="getting-started.html">Get started →</a>
    <a class="btn" href="why-neutrx.html">Why Neutrx</a>
    <a class="btn" href="api.html">API reference</a>
    <a class="btn" href="https://github.com/Xenial-Devil/neutrx">GitHub</a>
  </div>
  <div class="hero-badges">
    <span class="badge">📦 <b>npm</b> neutrx</span>
    <span class="badge">⚙️ Node <b>≥ 18</b></span>
    <span class="badge">🧩 ESM · CJS · <b>.d.ts</b></span>
    <span class="badge">⚖️ <b>MIT</b></span>
  </div>
</div>

<div class="stat-strip">
  <div class="stat"><span class="stat-num">0</span><span class="stat-label">Runtime dependencies</span></div>
  <div class="stat"><span class="stat-num">3</span><span class="stat-label">Security profiles</span></div>
  <div class="stat"><span class="stat-num">9+</span><span class="stat-label">First-party plugins</span></div>
  <div class="stat"><span class="stat-num">2</span><span class="stat-label">Builds: Node + Browser</span></div>
</div>

## Install

```bash
npm install neutrx
```

Requires **Node.js** `>= 18`. Zero runtime dependencies. Ships ESM + CommonJS + `.d.ts`, plus a separate browser build.

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  security: { profile: 'standard' },
});

const { data } = await api.get('/users/1');
```

{: .note }
> Neutrx is callable **and** an object: `neutrx(url)`, `neutrx.get(url)`, and `neutrx.create(config)` all work. The default export is a global instance; `create()` returns an isolated client with its own defaults, cache, circuit state, and metrics.

## Overview

<div class="card-grid">
  <a class="card" href="security-model.html">
    <span class="card-title">🛡️ Security by default</span>
    <span class="card-desc">SSRF + DNS pinning (TOCTOU-safe), redirect-downgrade protection, cross-origin credential stripping, cloud-metadata and dangerous-port blocking, TLS controls + cert pinning, size/timeout caps.</span>
  </a>
  <a class="card" href="retries.html">
    <span class="card-title">🔁 Resilience</span>
    <span class="card-desc">Retries with four backoff strategies, jitter, and budgets; per-origin circuit breaker; per-origin bulkhead with optional adaptive concurrency — no retry storms.</span>
  </a>
  <a class="card" href="cache.html">
    <span class="card-title">⚡ Performance</span>
    <span class="card-desc">Response caching (Cache-Control, SWR, stale-if-error, network-first), in-flight deduplication, async pagination, and DataLoader batching.</span>
  </a>
  <a class="card" href="plugins.html">
    <span class="card-title">🔌 Extensible</span>
    <span class="card-desc">Plugin SDK plus first-party plugins: AWS SigV4, HAR recording, OpenTelemetry, W3C/B3 trace context, validation, logging, mocks, GraphQL, OAuth2.</span>
  </a>
  <a class="card" href="observability.html">
    <span class="card-title">🧭 Observable</span>
    <span class="card-desc">Metrics with latency percentiles, Prometheus export, structured redacting errors, an OpenTelemetry client-span bridge, and trace-context propagation.</span>
  </a>
  <a class="card" href="browser-usage.html">
    <span class="card-title">🌐 Node + Browser</span>
    <span class="card-desc">Shared request API across a Node build and a browser build, with honest platform limits (no SSRF/DNS/TLS guarantees in the browser).</span>
  </a>
</div>

## A fuller example

```ts
import neutrx, { isNeutrxError, NeutrxHTTPError } from 'neutrx';

// Create one client per upstream service. Service-wide policy lives here;
// per-request config overrides only what a single call needs.
const api = neutrx.create({
  baseURL: 'https://billing.example.com', // prepended to relative request paths
  timeout: 8_000,                         // total deadline across retries (ms)

  // Security is enforced on every request. `standard` blocks private/metadata
  // IPs and dangerous ports; `allowedHosts` pins egress to one host.
  security: {
    profile: 'standard',
    allowedHosts: ['billing.example.com'],
  },

  // Resilience wraps the transport: retry -> bulkhead -> circuit breaker.
  resilience: {
    maxRetries: 3,             // retry idempotent calls up to 3 times
    retryStrategy: 'exponential', // 1s, 2s, 4s ... (with jitter), capped
    failureThreshold: 5,       // open the circuit after 5 consecutive failures
    maxConcurrent: 10,         // bulkhead: max in-flight requests per origin
  },

  // Stale-while-revalidate: serve cached data instantly, refresh in background.
  performance: { cacheStrategy: 'swr', cacheTTL: 60_000 },
});

try {
  // `data` is typed via generics/schema; `cached` is true on a cache hit.
  const { data, status, cached } = await api.get('/invoices', {
    params: { page: 1 }, // serialized to ?page=1
  });
  console.log(status, cached, data);
} catch (error) {
  // Re-throw anything that isn't a Neutrx error (programmer errors, etc.).
  if (!isNeutrxError(error)) throw error;

  // toJSON() is log-safe: secrets in URLs/headers/body are redacted.
  console.error(error.code, error.category, error.toJSON());

  // Narrow to a specific subclass for status-aware handling.
  if (error instanceof NeutrxHTTPError) console.error('HTTP', error.status);
}
```

## Get started

<div class="card-grid">
  <a class="card" href="getting-started.html">
    <span class="card-title">Getting Started</span>
    <span class="card-desc">Install, send your first request, create a client, pick a security profile, handle errors.</span>
  </a>
  <a class="card" href="node-usage.html">
    <span class="card-title">Node Usage</span>
    <span class="card-desc">Build a backend service client: methods, concurrency helpers, HTTP/2, TLS, sockets.</span>
  </a>
  <a class="card" href="node-infrastructure.html">
    <span class="card-title">Node Infrastructure</span>
    <span class="card-desc">Docker sockets, proxies, redirects, decompression, bandwidth caps, egress gateways.</span>
  </a>
  <a class="card" href="security-features.html">
    <span class="card-title">Security Features</span>
    <span class="card-desc">Profiles, exact per-profile defaults, SSRF internals, egress policy, redaction.</span>
  </a>
  <a class="card" href="axios-migration.html">
    <span class="card-title">Migrate from Axios</span>
    <span class="card-desc">Verb mapping, defaults, interceptors, cancellation, and security differences.</span>
  </a>
  <a class="card" href="config-reference.html">
    <span class="card-title">Config Reference</span>
    <span class="card-desc">Every config block: core, security, egress, resilience, performance, distributed state.</span>
  </a>
  <a class="card" href="api.html">
    <span class="card-title">API Reference</span>
    <span class="card-desc">Methods, request config, the response shape, plugins, state, batching, errors.</span>
  </a>
  <a class="card" href="errors.html">
    <span class="card-title">Errors</span>
    <span class="card-desc">The typed error hierarchy, codes, categories, and redacting <code>toJSON()</code>.</span>
  </a>
</div>

## Project facts

- **License:** MIT
- **Runtime deps:** none (optional `@opentelemetry/api` peer, detected lazily)
- **Node:** `>= 18`
- **Entry points:** `neutrx`, `neutrx/node`, `neutrx/browser`, `neutrx/plugins`, `neutrx/errors`, `neutrx/headers`, `neutrx/adapters`, `neutrx/instrumentation`
- [Changelog](https://github.com/Xenial-Devil/neutrx/blob/main/CHANGELOG.md) · [npm](https://www.npmjs.com/package/neutrx) · [Report an issue](https://github.com/Xenial-Devil/neutrx/issues)
