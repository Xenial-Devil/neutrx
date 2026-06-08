# Neutrx Security Guide

## Profiles

```ts
import neutrx from 'neutrx';

const strict = neutrx.create({ security: { profile: 'strict' } });
const standard = neutrx.create({ security: { profile: 'standard' } });
const legacy = neutrx.create({ security: { profile: 'legacy' } });
```

Use `strict` for untrusted URLs from a Node.js backend. Use `standard` for normal backend service calls. Use `legacy` only when migration targets are fully trusted. Browser security profiles cannot provide the same network-level guarantees as the built-in Node adapters.

## SSRF Protection

Strict and standard profiles block:

- `localhost`
- IPv4 loopback, private, carrier-grade NAT, link-local, and metadata ranges
- IPv6 loopback, unique-local, link-local, and known metadata addresses
- Cloud metadata hosts such as `metadata.google.internal`
- Numeric and hexadecimal IPv4 variants such as `2130706433` and `0x7f000001`

DNS results are validated before dispatch. The Node HTTP adapter pins the validated records into a request-local lookup to reduce DNS rebinding exposure.

`strict` and `standard` reject URLs with embedded username or password fields. Put credentials in headers instead so redirect handling and redaction can protect them.

```ts
const api = neutrx.create({
  security: {
    profile: 'strict',
    allowedHosts: ['api.example.com'],
  },
});
```

## Unix Sockets

Use `socketPath` only for trusted local services:

```ts
const docker = neutrx.create({
  baseURL: 'http://docker',
  socketPath: '/var/run/docker.sock',
  proxy: false,
});
```

With `socketPath`, Neutrx connects to the absolute local socket path and uses the URL host only as the HTTP `Host` header. DNS, SSRF, private-IP, HTTPS, and egress-policy network checks do not apply to that synthetic host. Neutrx still rejects unsafe socket paths, proxy/socket combinations, HTTPS socket URLs, unsafe headers, and URL credentials outside `legacy`.

## Egress Policy

Use `egressPolicy` when the allowed outbound network shape should be reviewable:

```ts
const webhooks = neutrx.create({
  security: { profile: 'strict' },
  egressPolicy: {
    mode: 'webhook-target',
    allowedProtocols: ['https'],
    allowedPorts: [443],
    requirePublicDns: true,
    blockCloudMetadata: true,
  },
});
```

See [secure-egress.md](secure-egress.md).

## Redirect Security

The built-in Node HTTP and HTTP/2 adapters validate each redirect target. Cross-origin redirects strip:

- `Authorization`
- `Cookie`
- `Proxy-Authorization`
- sensitive custom headers containing token, secret, password, or API key names
- `Host`

When a redirect changes a body method to `GET`, body headers such as `Content-Type`, `Content-Length`, and `Transfer-Encoding` are stripped.

Strict mode blocks HTTPS to HTTP downgrade redirects unless HTTPS enforcement is explicitly disabled.

Browser and edge fetch platforms may follow redirects internally or hide cross-origin redirect details. The browser build therefore cannot guarantee the same per-hop validation, downgrade blocking, sensitive-header stripping, or redirect limits.

## Browser Runtime Boundary

Normal browser JavaScript cannot inspect DNS answers or resolved private IPs, configure certificate pins, use raw sockets, or control all redirect and network details. Do not rely on browser `strict` mode or `egressPolicy` as a trusted SSRF boundary. Route user-controlled outbound targets through a trusted Node.js service and see [Browser usage](browser-usage.md).

## Error Redaction

Use `error.toJSON()` for logs:

```ts
try {
  await api.get('/billing?access_token=secret');
} catch (error) {
  if (error instanceof Error && 'toJSON' in error) {
    console.error((error as { toJSON(): unknown }).toJSON());
  }
}
```

Redaction covers common secret keys in URL params, headers, context, and response data.

## Local Development

```ts
const local = neutrx.create({
  baseURL: 'http://127.0.0.1:3000',
  security: {
    profile: 'legacy',
    blockMetadataIPs: true,
  },
});
```

Keep metadata blocking enabled unless a test explicitly proves it needs to be disabled.
