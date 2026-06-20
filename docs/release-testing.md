---
title: Release Testing
parent: Reference
nav_order: 4
---

# Release Testing

Run the full local release gate before publishing:

```bash
npm ci
npm run release:validate
```

`npm run release:validate` runs lint, typecheck, tests, coverage, docs build, package validation, and the packed-package smoke test. CI runs the same checks on Node 18, 20, and 22.

## Per-Release Checklist

Copy this checklist into the release issue or pull request. Check automated items after `npm run release:validate` and the Node.js CI matrix pass. Browser and edge target testing remains conditional on transport changes.

### Package Compatibility

- [ ] ESM import works.
- [ ] CommonJS require works.
- [ ] TypeScript types resolve.
- [ ] Package works after `npm pack`.
- [ ] Subpath exports work: `neutrx`, `neutrx/plugins`, and `neutrx/errors`.

### Runtime Compatibility

- [ ] Node 18 passes.
- [ ] Node 20 passes.
- [ ] Node 22 passes.
- [ ] Browser bundler smoke test passes.
- [ ] Edge/fetch runtime behavior is documented or tested.

### HTTP Behavior

- [ ] GET request.
- [ ] POST JSON request.
- [ ] Form upload.
- [ ] File/buffer upload.
- [ ] Timeout.
- [ ] Abort signal.
- [ ] Redirect.
- [ ] Decompression.
- [ ] Progress events.
- [ ] Error response.
- [ ] Retry behavior.

### Security Behavior

- [ ] SSRF protection still works.
- [ ] Private IP blocking still works in the Node adapter.
- [ ] Header injection guard still works.
- [ ] Prototype pollution guard still works.
- [ ] Certificate pinning still works in the Node adapter.
- [ ] Browser limitations are documented.

### Resilience Behavior

- [ ] Circuit breaker opens after threshold.
- [ ] Circuit breaker resets after timeout.
- [ ] Bulkhead limits concurrency.
- [ ] Fixed, linear, exponential, and fibonacci retry strategies work.

### Observability Behavior

- [ ] Prometheus metrics still work.
- [ ] Request timing still works.
- [ ] OpenTelemetry spans work when OpenTelemetry is installed.
- [ ] OpenTelemetry integration is a no-op when OpenTelemetry is not installed.

## Automated Release Checklist

Package compatibility:

- ESM import and CommonJS require are tested from built output and from an installed `npm pack` artifact.
- Published TypeScript declarations are compiled from the installed packed artifact.
- Packed ESM, CJS, and types resolve for `neutrx`, `neutrx/plugins`, and `neutrx/errors`.
- The packed root export is bundled with esbuild under the `browser` condition and checked for Node core imports.

Runtime and HTTP behavior:

- CI covers Node 18, 20, and 22.
- Local-server tests cover GET, POST JSON, multipart forms, file and buffer bodies, timeout, abort, redirects, decompression, progress events, error responses, and retries.
- Browser-entry tests cover fetch, timeout, abort, progress, XSRF behavior, and an edge-like runtime without `window`, `document`, or `location`.

Security behavior:

- SSRF and private-address blocking are tested at URL validation and Node DNS lookup boundaries.
- Redirect downgrade/private-target blocking and credential stripping are tested.
- Header CRLF injection and prototype pollution guards are tested.
- Certificate pin validation is tested in the Node security manager and wired into the Node HTTP and HTTP/2 adapters.

Resilience and observability:

- Circuit opening and timeout reset behavior are tested.
- Bulkhead concurrency and queuing behavior are tested.
- Fixed, linear, exponential, and fibonacci retry delays are tested explicitly.
- Request timing, Prometheus output, OpenTelemetry spans, and the no-OpenTelemetry no-op path are tested.

## Browser And Edge Limits

The browser build is a secondary compatibility surface. Normal browser JavaScript cannot provide Node adapter guarantees for DNS resolution, private-IP inspection, certificate pinning, custom CA, mTLS, proxy tunneling, or raw socket controls.

The browser and edge-like fetch behavior is automated, but a release that changes browser transport behavior should also be exercised in the target application's supported browsers and bundler. See [Browser Usage](browser-usage.md) and [Adapter Security Contract](adapter-security-contract.md).

## Manual Release Review

After automated validation:

- Review `npm pack --dry-run` output for unexpected files.
- Confirm the release notes call out security, runtime, package-export, resilience, or observability changes.
- Confirm the GitHub Actions matrix is green for Node 18, 20, and 22.
- Confirm the published package and provenance record match the intended version.
