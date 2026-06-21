# Neutrx Threat Model

## Scope

Neutrx protects Node.js backend services making outbound HTTP requests, especially when request URLs, redirect targets, headers, or payloads may be influenced by external input. The browser build is a compatibility surface and is not a trusted SSRF, DNS, TLS, socket, or redirect-hop enforcement boundary.

## Protected Assets

- Service credentials in headers, cookies, proxy credentials, and request URLs.
- Internal network resources reachable from the running process.
- Cloud metadata services.
- Service availability under transient failures.
- Logs and serialized errors.

## Main Threats

| Threat | Mitigation |
| --- | --- |
| SSRF to localhost/private IPs | URL checks, DNS resolution validation, pinned lookup, redirect revalidation |
| Cloud metadata access | Metadata IPv4/IPv6/host blocks in strict and standard profiles |
| DNS rebinding | Validate resolved addresses and pin DNS result for the request where Node HTTP adapter is used |
| Credential leakage on redirect | Strip `Authorization`, `Cookie`, `Proxy-Authorization`, `Host`, and sensitive custom headers on cross-origin redirects |
| HTTPS downgrade | Strict/standard redirect downgrade block when HTTPS enforcement is enabled |
| Oversized request/response | `maxBodyLength` and `maxContentLength` |
| Secret leakage in errors | `NeutrxError.toJSON()` redacts sensitive keys, URL params, headers, and response data |
| Retry storms | Idempotent-method retries by default, backoff, jitter, retry budget |
| Cascading failures | Circuit breaker and bulkhead isolation |

## Example Scenarios

### Webhook SSRF

A user registers `https://example.com/callback`, then changes DNS or redirects to `http://169.254.169.254/latest/meta-data/`. Use `security.profile: 'strict'`, `egressPolicy.mode: 'webhook-target'`, DNS answer validation, redirect validation, and small response limits.

### Redirect Credential Leak

An API endpoint returns a redirect to another origin. Neutrx strips `Authorization`, `Cookie`, `Proxy-Authorization`, `Host`, and sensitive custom headers before following cross-origin redirects.

### Metadata IP Leak

Cloud metadata endpoints can appear as IPv4, IPv6, host aliases, decimal/octal/hex IPv4, or IPv4-mapped IPv6. Strict and standard profiles block those forms, and `egressPolicy.blockCloudMetadata` keeps the rule explicit.

### Retry Storm

Many service instances retrying a failing upstream can amplify an outage. Use idempotent retries, jitter, retry budgets, circuit breaker, and bulkhead limits. Distributed retry/circuit state belongs in optional plugins, not core runtime dependencies.

## Out Of Scope

- Browser-side SSRF, DNS, TLS, raw-socket, and redirect-hop enforcement. See [Browser usage](docs/browser-usage.md) for runtime-specific limits.
- Full WAF behavior or payload malware detection.
- Distributed cache implementation such as Redis.
- Guaranteed protection when callers disable SSRF checks or use `legacy` for untrusted URLs.
- Protection from compromised DNS resolvers returning public IPs controlled by an attacker.

## Security Profiles

`strict` is intended for untrusted or user-controlled URLs. It requires HTTPS unless disabled, blocks internal networks and metadata services, validates redirects, and redacts errors.

`standard` keeps SSRF and redirect protections on by default and is suitable for normal service-to-service calls.

`legacy` relaxes network blocking for migration and trusted local testing. Do not use it for user-controlled URLs. Deprecated profile aliases are accepted only for migration compatibility and are normalized internally.

## Request Signing And Replay Defense

When a signing secret is configured, Neutrx HMACs every outbound request and attaches three headers:

- `X-Neutrx-Timestamp` — `Date.now()` in milliseconds.
- `X-Neutrx-Nonce` — 16 random bytes (`crypto.randomBytes(16)`) hex-encoded (32 chars).
- `X-Neutrx-Signature` — `HMAC(secret, "<method>:<url>:<timestamp>:<nonce>:<body>")` (default `sha256`, hex). Body is serialized deterministically; streams/blobs/form-data sign a stable placeholder, not their contents.

The nonce + timestamp defeat replay **only if the server enforces them.** Neutrx is the client half of the contract; it cannot detect replays on its own. Server-side contract:

1. Recompute the HMAC over the same payload using the shared secret and reject on mismatch (constant-time compare).
2. Reject requests whose `X-Neutrx-Timestamp` is outside an accepted clock-skew window (e.g. ±5 min).
3. Track seen `X-Neutrx-Nonce` values within that window and reject duplicates. A nonce-store TTL equal to the skew window bounds memory.

Without steps 2–3 a captured request can be replayed verbatim — the signature stays valid. Streaming/blob/form-data bodies are not covered by the signature; sign such requests at a higher layer if body integrity matters.

## Review Checklist

- Keep Node.js minimum at `>=18.0.0`.
- Keep URL, DNS, and redirect checks covered by tests.
- Add tests before relaxing any default security behavior.
- Never log raw `error.response`, request headers, or URLs with credentials; use `error.toJSON()`.
