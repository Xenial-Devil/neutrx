# Neutrx Threat Model

## Scope

Neutrx protects Node.js backend services making outbound HTTP requests, especially when request URLs, redirect targets, headers, or payloads may be influenced by external input.

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
| Cloud metadata access | Metadata IPv4/IPv6/host blocks in strict and balanced profiles |
| DNS rebinding | Validate resolved addresses and pin DNS result for the request where Node HTTP adapter is used |
| Credential leakage on redirect | Strip `Authorization`, `Cookie`, `Proxy-Authorization`, and `Host` on cross-origin redirects |
| HTTPS downgrade | Strict/balanced redirect downgrade block when HTTPS enforcement is enabled |
| Oversized request/response | `maxBodyLength` and `maxContentLength` |
| Secret leakage in errors | `NeutrxError.toJSON()` redacts sensitive keys, URL params, headers, and response data |
| Retry storms | Idempotent-method retries by default, backoff, jitter, retry budget |
| Cascading failures | Circuit breaker and bulkhead isolation |

## Out Of Scope

- Browser-side SSRF prevention.
- Full WAF behavior or payload malware detection.
- Distributed cache implementation such as Redis.
- Guaranteed protection when callers disable SSRF checks or use `axios-compatible` for untrusted URLs.
- Protection from compromised DNS resolvers returning public IPs controlled by an attacker.

## Security Profiles

`strict` is intended for untrusted or user-controlled URLs. It requires HTTPS unless disabled, blocks internal networks and metadata services, validates redirects, and redacts errors.

`balanced` keeps SSRF and redirect protections on by default and is suitable for normal service-to-service calls.

`axios-compatible` relaxes network blocking for migration and trusted local testing. Do not use it for user-controlled URLs.

## Review Checklist

- Keep Node.js minimum at `>=22.0.0`.
- Keep URL, DNS, and redirect checks covered by tests.
- Add tests before relaxing any default security behavior.
- Never log raw `error.response`, request headers, or URLs with credentials; use `error.toJSON()`.
