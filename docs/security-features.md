---
title: Security Features
parent: Security
nav_order: 1
---

# Security Features
{: .no_toc }

1. TOC
{:toc}

---

Neutrx treats outbound HTTP from Node.js backends as a security boundary. The built-in Node adapters provide the strongest SSRF, redirect, TLS, and egress controls. Browser and edge fetch runtimes keep application-level protections but **cannot** provide equivalent network enforcement — see [Browser Usage](browser-usage.md).

## Security profiles

```ts
const strict   = neutrx.create({ security: { profile: 'strict' } });
const standard = neutrx.create({ security: { profile: 'standard' } }); // default
const legacy   = neutrx.create({ security: { profile: 'legacy' } });
```

| Profile | Use it for |
| --- | --- |
| `strict` | User-controlled URLs, webhook targets, admin tools, high-risk egress |
| `standard` *(default)* | Normal production service-to-service traffic |
| `legacy` | Trusted migrations and local testing only |

Docs and examples use canonical names only: `strict`, `standard`, `legacy`. (`balanced` is a deprecated alias normalized to `standard`.)

### Exact per-profile defaults

These are the baseline values each profile applies. Any option can be overridden explicitly.

| Option | `strict` | `standard` | `legacy` |
| --- | --- | --- | --- |
| `allowedProtocols` | `['https']` | `['http','https']` | `['http','https']` |
| `enforceHTTPS` | `true` | `true` | `false` |
| `blockPrivateIPs` | `true` | `true` | `false` |
| `blockLoopbackIPs` | `true` | `true` | `false` |
| `blockLinkLocalIPs` | `true` | `true` | `false` |
| `blockMetadataIPs` | `true` | `true` | `false` |
| `blockDangerousPorts` | `true` | `true` | `false` |
| `allowLocalhost` | `false` | `false` | `true` |

Additional profile rules:

- `legacy` is the only profile that allows `insecureHTTPParser` and URL credentials (`user:pass@host`). Other profiles reject them (`INSECURE_PARSER_BLOCKED`, `URL_CREDENTIALS_BLOCKED`).
- Under `strict` with `NODE_ENV=production`, HTTPS is force-enforced (`HTTPS_REQUIRED`).

{: .danger }
> `legacy` disables SSRF protection. Never point a `legacy` client at user-influenced URLs.

## All security options

Set any of these under `security` on the client or per request:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `profile` | `'strict' \| 'standard' \| 'legacy'` | `'standard'` | Baseline (see table above) |
| `enableSSRFProtection` | `boolean` | `true` | Master SSRF toggle |
| `allowedHosts` | `string[]` | — | Allow-list (supports `*.example.com`, `*`) |
| `deniedHosts` | `string[]` | — | Deny-list (same patterns) |
| `allowedProtocols` | `string[]` | per profile | Permitted URL schemes |
| `enforceHTTPS` | `boolean` | per profile | Require `https:` |
| `validateCertificate` | `boolean` | `true` | TLS certificate validation |
| `blockPrivateIPs` | `boolean` | per profile | Block RFC1918 + CGNAT ranges |
| `blockLoopbackIPs` | `boolean` | per profile | Block `127.0.0.0/8`, `::1` |
| `blockLinkLocalIPs` | `boolean` | per profile | Block `169.254.0.0/16`, `fe80::/10` |
| `blockMetadataIPs` | `boolean` | per profile | Block cloud metadata IPs |
| `blockDangerousPorts` | `boolean` | per profile | Block the port list below |
| `allowLocalhost` | `boolean` | per profile | Permit loopback (overrides loopback block) |
| `reResolveOnRedirect` | `boolean` | `true` | Re-validate DNS on each redirect |
| `blockRedirectToPrivateIP` | `boolean` | `true` | Apply SSRF checks to redirect targets |
| `sanitizeInputs` | `boolean` | `true` | Strip null bytes / detect prototype pollution in request |
| `sanitizeOutputs` | `boolean` | `true` | Same checks on responses |
| `rateLimit` | `RateLimitConfig` | disabled | Client-side request rate limiting |

## SSRF protection

With `enableSSRFProtection` (on for `strict`/`standard`), Neutrx blocks:

- **IPv4:** loopback `127.0.0.0/8`, private `10/8`, `172.16/12`, `192.168/16`, CGNAT `100.64/10`, `0.0.0.0/8`, link-local `169.254/16`.
- **IPv6:** loopback `::1`, unique-local `fc00::/7`, link-local `fe80::/10`, IPv4-mapped forms.
- **Cloud metadata:** `169.254.169.254`, `100.100.100.200`, `fd00:ec2::254`, and host aliases like `metadata.google.internal`.
- Decimal/octal/hex IPv4 variants (e.g. `2130706433`, `0x7f000001`) where URL parsing allows them.
- Hosts missing from `allowedHosts` or matching `deniedHosts`.

The Node HTTP adapter validates DNS answers **before dispatch** and pins the validated records into a request-local lookup — closing the DNS-rebinding (TOCTOU) window. `reResolveOnRedirect` repeats this on every hop.

### Dangerous ports

When `blockDangerousPorts` is on, these are rejected:

```
22 (SSH), 23 (Telnet), 25 (SMTP), 53 (DNS), 110 (POP3), 143 (IMAP),
3306 (MySQL), 5432 (PostgreSQL), 6379 (Redis), 27017 (MongoDB), 11211 (Memcached)
```

### URL credentials

`strict` and `standard` reject URLs with embedded `user:password@`. Put credentials in headers so redirect handling and redaction can protect them.

## Egress policy

When the allowed outbound shape should be reviewable in config, layer `egressPolicy` on top of the profile:

```ts
const webhooks = neutrx.create({
  security: { profile: 'strict' },
  egressPolicy: {
    mode: 'webhook-target',
    allowedProtocols: ['https'],
    allowedPorts: [443],
    requireHttps: true,
    requirePublicDns: true,
    blockCloudMetadata: true,
  },
});
```

See [Secure Egress](secure-egress.md) for presets and every field.

## Redirect safety

The Node HTTP/HTTP2 adapters validate every redirect target before following it. On cross-origin hops they strip `Authorization`, `Cookie`, `Proxy-Authorization`, `Host`, and sensitive custom headers (token/secret/password/api-key patterns). On a method-changing redirect (POST→GET) body headers are dropped. HTTPS→HTTP downgrades are blocked while HTTPS is enforced.

## Certificate pinning, signing, and rate limiting

```ts
api.pinCertificate('payments.example.com', sha256Hex);      // pin a cert fingerprint
api.enableRequestSigning(process.env.HMAC_SECRET, 'sha256'); // HMAC-sign every request
api.blockDomain('evil.example');                             // runtime deny

const limited = neutrx.create({
  security: {
    rateLimit: {
      enabled: true,
      algorithm: 'token_bucket', // | 'sliding_window' | 'fixed_window'
      maxRequests: 100,
      windowMs: 60_000,
      burstSize: 20,
      perDomain: true,
    },
  },
});
```

`security.rateLimit` caps request **counts**; [`maxRate`](node-infrastructure.md) caps **byte throughput**.

## Error redaction

```ts
try {
  await api.get('/billing?access_token=secret');
} catch (error) {
  if (isNeutrxError(error)) console.error(error.toJSON()); // token redacted
}
```

`toJSON()` redacts common secret fields in URLs, headers, context, and response data. Prefer it over raw error logging. See [Errors](errors.md).

## Size limits and timeouts

```ts
const api = neutrx.create({
  timeout: 5_000,           // total deadline (default 30_000)
  connectTimeout: 2_000,    // handshake budget (default 10_000)
  maxBodyLength: 2 * 1024 * 1024,     // request cap (default 10 MB)
  maxContentLength: 10 * 1024 * 1024, // response cap (default 50 MB)
});
```

Finite timeouts and size caps are part of the security model — they bound resource use during slow, oversized, or malicious responses.

## Runtime boundary

A `strict` profile in a browser is **not** a Node-equivalent egress boundary: browser JS can't inspect DNS answers, pin certificates, use raw sockets, or guarantee per-hop redirect visibility. Route untrusted outbound targets through a trusted Node service. See [Browser Usage](browser-usage.md) for the full capability matrix.

## More detail

- [Security Model](security-model.md) · [Security Guide](security.md)
- [Secure Egress](secure-egress.md) · [Adapter Security Contract](adapter-security-contract.md)
- [Errors](errors.md)
