# Neutrx Security Guide

## Profiles

```ts
import neutrx from 'neutrx';

const strict = neutrx.create({ security: { profile: 'strict' } });
const standard = neutrx.create({ security: { profile: 'standard' } });
const legacy = neutrx.create({ security: { profile: 'legacy' } });
```

Use `strict` for untrusted URLs. Use `standard` for normal backend service calls. Use `legacy` only when migration targets are fully trusted.

## SSRF Protection

Strict and standard profiles block:

- `localhost`
- IPv4 loopback, private, carrier-grade NAT, link-local, and metadata ranges
- IPv6 loopback, unique-local, link-local, and known metadata addresses
- Cloud metadata hosts such as `metadata.google.internal`
- Numeric and hexadecimal IPv4 variants such as `2130706433` and `0x7f000001`

DNS results are validated before dispatch. The Node HTTP adapter pins the validated records into a request-local lookup to reduce DNS rebinding exposure.

```ts
const api = neutrx.create({
  security: {
    profile: 'strict',
    allowedHosts: ['api.example.com'],
  },
});
```

## Redirect Security

Neutrx validates each redirect target. Cross-origin redirects strip:

- `Authorization`
- `Cookie`
- `Proxy-Authorization`
- `Host`

When a redirect changes a body method to `GET`, body headers such as `Content-Type`, `Content-Length`, and `Transfer-Encoding` are stripped.

Strict mode blocks HTTPS to HTTP downgrade redirects unless HTTPS enforcement is explicitly disabled.

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
