---
title: Browser Usage
description: "Use the Neutrx browser build with native fetch while understanding which Node-level SSRF, DNS, TLS, and transport controls do not apply."
parent: Guides
nav_order: 3
---

# Browser Usage

Browser support exists through `neutrx/browser` and the package `browser` condition. It is useful when you want Neutrx request ergonomics in frontend code, while accepting normal browser platform limits.

For a side-by-side migration view covering adapters, `NeutrxHeaders`, `instance.defaults`, interceptor options, richer progress events, and Axios workflow mappings, see [Full-stack and frontend migration](full-stack-frontend-migration.md).

```ts
import neutrx from 'neutrx/browser';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  adapter: 'fetch',
  credentials: 'include',
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
});

const users = await api.get('/users', {
  responseType: 'json',
  signal: AbortSignal.timeout(5_000),
});
```

In browser bundlers, `import neutrx from 'neutrx'` can resolve to the browser build through the package `browser` export condition. Importing `neutrx/browser` is explicit.

## Supported Browser Behavior

- Native `fetch`, `Request`, `Response`, and `Headers`.
- JSON, text, Blob, ArrayBuffer, and FormData responses where the platform supports them.
- Abort signals and request timeouts.
- XSRF header helpers using browser cookies where available.
- Download progress when fetch exposes readable response streams and content length.

## Runtime Security Boundary

The browser build delegates network transport to platform `fetch`. The browser chooses DNS resolution, TLS verification, connection reuse, proxy behavior, and some redirect behavior. Normal browser JavaScript cannot inspect or replace those decisions.

| Control | Node HTTP and HTTP/2 adapters | Browser and edge fetch runtimes |
| --- | --- | --- |
| DNS and SSRF checks | Resolve targets, reject unsafe private or metadata addresses, and pin validated DNS answers. | Cannot inspect DNS answers or determine whether a hostname resolves to a private, metadata, or rebound address. |
| TLS policy | Can configure custom CA, mTLS, SNI policy, and certificate pins. | Uses the platform trust store and TLS policy; normal JavaScript cannot configure certificate pins, custom CA, or mTLS client certificates. |
| Redirect policy | Neutrx observes and validates each hop, blocks configured downgrades, and strips sensitive headers before the next request. | The platform may follow redirects internally or hide cross-origin redirect details, so Neutrx cannot guarantee Node-equivalent per-hop validation, downgrade blocking, header stripping, `maxRedirects`, or `beforeRedirect` behavior. |
| Transport control | Can use agents, proxies, Unix sockets, raw socket details, and socket-level bandwidth limits. | Does not expose raw sockets, Unix sockets, custom agents, proxy tunneling, or socket-level bandwidth control. |
| WebSocket handshake | Node can send prepared custom headers during the upgrade. | The platform `WebSocket` constructor does not allow custom handshake headers. |

A `strict` security profile does not turn a browser client into a Node-equivalent egress boundary. Network policy options that depend on DNS, CIDRs, SNI, certificate pins, or observed redirect hops cannot provide the same guarantees in browsers. Do not treat browser `allowedHosts`, `deniedHosts`, `egressPolicy`, `followRedirects`, `maxRedirects`, or `beforeRedirect` settings as an equivalent server-side egress firewall.

## Protections That Still Apply

The browser build still provides application-level protections and behavior where platform APIs expose the required information:

- Initial URL parsing and HTTP/HTTPS protocol checks.
- Unsafe header validation, input/output sanitization, and typed redacted errors.
- Abort signals, timeouts, and response size checks for observable response bodies.
- Retries, circuit breaking, bulkheads, cache behavior, metrics, tracing, and schema validation.

Browser CORS, Content Security Policy, mixed-content blocking, and credential rules may add platform protections, but they are browser controls rather than Neutrx security guarantees.

## Deployment Guidance

- Do not fetch user-controlled webhook or callback URLs directly from the browser and rely on Neutrx for SSRF protection.
- Send untrusted target requests through a trusted Node.js service using `security.profile: 'strict'` and an explicit `egressPolicy`.
- Prefer fixed or same-origin API endpoints in frontend code, and use server-side allow-lists for sensitive outbound access.

Neutrx remains backend-focused. Use the browser build for shared request ergonomics while accepting these runtime-specific limits.

## Browser File Request

```ts
const photo = await api.get<Blob>('/me/photo', {
  responseType: 'blob',
});
```

## Browser Form Request

```ts
const form = new FormData();
form.set('name', 'monthly-report');
form.set('file', fileInput.files?.[0] ?? new Blob(['empty']));

await api.post('/uploads', form, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
```
