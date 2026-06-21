---
title: Secure Egress
parent: Security
nav_order: 3
---

# Secure Egress Policy

`egressPolicy` makes outbound network intent reviewable in one object. It adds policy checks on top of security profiles. It does not weaken SSRF defaults unless you explicitly allow a CIDR.

The built-in Node HTTP and HTTP/2 adapters are the enforcement boundary for DNS, CIDR, SNI, private-IP, metadata, and redirect-hop policy. Browser and edge fetch runtimes do not expose enough network detail to provide equivalent enforcement. Route untrusted outbound targets through a trusted Node.js service rather than relying on browser `egressPolicy`.

## Webhook Or User-Controlled URLs

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

await webhooks.get(userProvidedUrl);
```

## Public API Client

```ts
const partners = neutrx.create({
  baseURL: 'https://api.partner.example',
  security: { profile: 'standard' },
  egressPolicy: {
    mode: 'public-api',
    allowedHosts: ['api.partner.example'],
    allowRedirectsTo: ['api.partner.example'],
  },
});
```

## Internal Service Client

For reviewed private ranges, use explicit CIDRs instead of disabling SSRF broadly:

```ts
const inventory = neutrx.create({
  baseURL: 'http://10.42.1.10:8080',
  security: {
    profile: 'standard',
    enforceHTTPS: false,
  },
  egressPolicy: {
    mode: 'internal-service',
    allowedCidrs: ['10.42.0.0/16'],
    deniedCidrs: ['10.42.9.0/24'],
    allowedPorts: [8080],
    blockCloudMetadata: true,
  },
});
```

`allowedCidrs` is a narrow exception for private ranges. Cloud metadata remains blocked when `blockCloudMetadata` is enabled.

## Policy Fields

| Field | Effect |
| --- | --- |
| `mode` | Preset: `public-api`, `internal-service`, `webhook-target`, `legacy-migration` |
| `allowedProtocols` | Allows only listed protocols, without trailing colon |
| `allowedHosts` | Host allow-list with exact and wildcard patterns |
| `deniedHosts` | Host deny-list with exact and wildcard patterns |
| `allowedCidrs` | CIDR ranges that may be reached |
| `deniedCidrs` | CIDR ranges that are always blocked |
| `allowedPorts` | Allows only listed effective ports |
| `requireHttps` | Requires `https:` URLs |
| `allowRedirectsTo` | Redirect target host allow-list |
| `blockCloudMetadata` | Blocks cloud metadata IPv4, IPv6, and host aliases |
| `requirePublicDns` | Blocks private, loopback, link-local, and metadata DNS answers |
| `allowedSni` | Requires URL hostname to match reviewed SNI host patterns |

## Audit Output

```ts
console.log(api.getEgressPolicy());
```

The audit output is safe to log because it contains policy shape, not credentials or request URLs.
