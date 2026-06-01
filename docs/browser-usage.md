# Browser Usage

Browser support exists through `neutrx/browser` and the package `browser` condition. It is useful when you want Neutrx request ergonomics in frontend code, while accepting normal browser platform limits.

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

## Platform Limits

Browsers do not expose the same controls as Node:

- No raw socket access or Unix sockets.
- No custom DNS resolution or DNS rebinding pinning.
- No custom CA, mTLS client certificate, or certificate pinning control from normal JavaScript.
- No direct private IP inspection before browser fetch dispatch.
- No proxy tunneling, custom HTTP agents, or socket-level bandwidth rate limiting.
- No custom WebSocket handshake headers from the platform `WebSocket` constructor.

Neutrx remains backend-focused. Use the browser build for shared ergonomics, not for Node-level SSRF guarantees.

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
