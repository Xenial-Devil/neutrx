# Security Model

Neutrx is designed for Node.js 22+ backend services making outbound HTTP calls. Its main security goal is to make dangerous outbound targets and credential leaks harder to trigger by accident.

## Profiles

- `strict`: use for user-controlled URLs, webhook targets, admin tools, and high-risk egress.
- `standard`: default production service-to-service profile.
- `legacy`: trusted migrations and local testing only.

Deprecated profile aliases are normalized internally for migration compatibility. New code should use only `strict`, `standard`, or `legacy`.

## SSRF Controls

`strict` and `standard` block:

- `localhost`, loopback, `0.0.0.0`, private IPv4, carrier-grade NAT, link-local, and metadata IP ranges
- IPv6 loopback, unique-local, link-local, metadata, and IPv4-mapped IPv6 forms
- decimal, octal, and hexadecimal IPv4 variants where Node URL parsing allows them
- cloud metadata hosts such as `metadata.google.internal`
- denied hosts and hosts missing from an allow-list

The Node HTTP adapter validates DNS answers and pins the validated lookup for the request.

## Redirect Safety

Each Node HTTP redirect target is revalidated. Cross-origin or downgrade redirects strip:

- `Authorization`
- `Cookie`
- `Proxy-Authorization`
- sensitive custom headers such as API keys, tokens, passwords, and client secrets

When a redirect changes a body method to `GET`, body headers are removed.

## Secret Redaction

Use `error.toJSON()` and `getMetrics()` output for logs. Do not log raw request configs, raw headers, or raw response objects.

Redaction covers common secret names in URLs, headers, context, and response data. OpenTelemetry attributes avoid query strings by default.

## Known Limits

- Browser builds cannot provide Node DNS validation.
- Custom adapters must preserve Neutrx security semantics if they follow redirects internally.
- Disabling SSRF checks or using `legacy` for untrusted URLs is unsafe.
