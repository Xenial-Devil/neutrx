# Security Features

Neutrx treats outbound HTTP as a backend security boundary. The defaults are designed to reduce SSRF risk, redirect credential leaks, unsafe logging, and unbounded request or response bodies.

## Security Profiles

```ts
const strict = neutrx.create({ security: { profile: 'strict' } });
const standard = neutrx.create({ security: { profile: 'standard' } });
const legacy = neutrx.create({ security: { profile: 'legacy' } });
```

- `strict`: user-controlled URLs, webhook targets, admin tools, and high-risk egress.
- `standard`: normal production service-to-service traffic.
- `legacy`: trusted migrations and local testing only.

Docs and examples use canonical names only: `strict`, `standard`, and `legacy`.

## SSRF Protection

`strict` and `standard` protect against common SSRF targets:

- `localhost`, loopback, private IPv4, carrier-grade NAT, link-local, and metadata ranges.
- IPv6 loopback, unique-local, link-local, and metadata ranges.
- Cloud metadata host aliases such as `metadata.google.internal`.
- Numeric, octal, and hexadecimal IPv4 variants where URL parsing allows them.
- Hosts missing from `allowedHosts` or matching `deniedHosts`.

The Node HTTP adapter validates DNS results before dispatch and pins validated records into the request lookup to reduce DNS rebinding exposure.

## Egress Policy

Use `egressPolicy` when outbound network intent should be reviewable in config:

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

See [Secure egress policy](secure-egress.md) for presets and fields.

## Redirect Safety

Neutrx validates every redirect target before following it. Cross-origin redirects strip:

- `Authorization`
- `Cookie`
- `Proxy-Authorization`
- `Host`
- sensitive custom headers containing token, secret, password, cookie, or API key names

Strict mode blocks HTTPS to HTTP downgrade redirects unless HTTPS enforcement is explicitly disabled.

## Error Redaction

```ts
try {
  await api.get('/billing?access_token=secret');
} catch (error) {
  if (isNeutrxError(error)) {
    console.error(error.toJSON());
  }
}
```

`toJSON()` redacts common secret fields in URLs, headers, context, and response data. Prefer it over raw error logging.

## Size Limits And Timeouts

```ts
const api = neutrx.create({
  timeout: 5_000,
  connectTimeout: 2_000,
  maxBodyLength: 2 * 1024 * 1024,
  maxContentLength: 10 * 1024 * 1024,
  security: { profile: 'standard' },
});
```

Finite timeouts and size limits are part of the security model. They limit resource use during slow, large, or malicious upstream responses.

## Unix Socket Boundary

`socketPath` is trusted local transport configuration:

```ts
const docker = neutrx.create({
  baseURL: 'http://docker',
  socketPath: '/var/run/docker.sock',
  proxy: false,
});
```

When a socket path is used, there is no DNS or TCP egress target to inspect. Neutrx validates the local socket path and rejects unsafe proxy/socket combinations, but you should never derive `socketPath` from user input.

## More Detail

- [Security guide](security.md)
- [Security model](security-model.md)
- [Secure egress policy](secure-egress.md)
- [Adapter security contract](adapter-security-contract.md)
- [Errors](errors.md)
