# Security Model

Neutrx is designed for Node.js 18+ backend services making outbound HTTP calls. Its main security goal is to make dangerous outbound targets and credential leaks harder to trigger by accident.

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

## Unix Sockets

`socketPath` is a local transport escape hatch for HTTP-over-Unix-socket services such as Docker Engine. When `socketPath` is set, the adapter connects to the absolute local socket path and treats the URL host as the HTTP `Host` header only. DNS, SSRF, private-IP, HTTPS, and egress-policy network checks are skipped for that synthetic host because there is no outbound TCP connection.

Neutrx still rejects relative socket paths, null bytes, CR/LF characters, proxy use with sockets, HTTPS socket URLs, unsafe headers, and URL credentials outside `legacy`. Treat `socketPath` as privileged configuration and do not accept it from untrusted input.

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

## Runtime-Specific Limits

- The strongest SSRF, DNS pinning, private-IP, redirect-hop, TLS, certificate-pinning, proxy, and socket controls require the built-in Node HTTP or HTTP/2 adapters.
- Browser and edge fetch runtimes do not expose DNS answers, resolved private-IP inspection, raw sockets, or normal JavaScript certificate controls. The platform may also follow redirects internally or hide redirect details, so the browser build cannot promise Node-equivalent redirect enforcement.
- A `strict` profile in a browser does not create a trusted egress boundary. Route untrusted target URLs through a trusted Node.js service with explicit egress policy.
- Custom adapters must preserve Neutrx security semantics if they follow redirects internally.
- Disabling SSRF checks or using `legacy` for untrusted URLs is unsafe.

See [Browser usage](browser-usage.md) for the runtime capability matrix and deployment guidance.
