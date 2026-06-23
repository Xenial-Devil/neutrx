---
title: Why Neutrx
nav_order: 8
---

# Why Neutrx
{: .no_toc }

1. TOC
{:toc}

---

Neutrx is for **Node.js backend egress where outbound HTTP is a security boundary** — calling internal services, partner APIs, webhooks, and user-influenced URLs from a server you control.

This is not a claim that Neutrx beats Axios everywhere. Axios is broader, older, and stronger for mixed browser + Node apps. Neutrx wins when a backend needs secure defaults around user-influenced URLs, internal calls, resilience, typed redacted errors, and observability — in one zero-dependency client.

## The problem it solves

A server-side HTTP call that takes a URL, hostname, or redirect from anywhere outside your trust boundary is an [SSRF](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery) vector. With a stock client you must remember, on every call, to:

- block private / loopback / link-local ranges and cloud-metadata IPs (`169.254.169.254`),
- pin DNS so a name can't re-resolve to an internal IP between check and connect (TOCTOU),
- stop HTTPS→HTTP downgrades and strip `Authorization`/`Cookie` on cross-origin redirects,
- cap body size, redirects, and time,
- and keep secrets out of your logs.

Neutrx does all of this by default and makes weakening it explicit and auditable.

## Choose Neutrx when

- You run **Node.js 18+** backend services.
- Requests may be influenced by users, webhooks, partners, or integrations.
- SSRF, cloud-metadata access, redirect credential leaks, and secret logging are real risks.
- You want retries (with budgets), circuit breaker, bulkhead isolation, schema validation, redacted typed errors, Prometheus metrics, W3C/B3 propagation, and an OpenTelemetry client-span bridge in **one** client.
- You want **zero required runtime dependencies** in core.

## Keep Axios or native fetch when

- The browser is your main product surface (Neutrx's browser build cannot provide Node-level network security).
- React Native, Bun, Deno, or pre-18 Node is required.
- You depend heavily on Axios-specific community adapters beyond the small `CancelToken` migration bridge Neutrx provides.
- You need a general-purpose client more than a backend egress-policy layer.

## How it compares

| Client | Best fit | Security/resilience policy |
| --- | --- | --- |
| **Axios** | Broad browser + Node compatibility | Lives in userland; you wire SSRF/retries/redaction yourself |
| **Native fetch / Undici** | Minimal modern HTTP | Great baseline; security and resilience stay in userland |
| **Got** | Node convenience, rich options | Mature Node client; retries built in, not a zero-dep security core |
| **Ky** | Browser-first fetch ergonomics | Frontend fetch wrapper |
| **Neutrx** | Secure Node backend service-to-service HTTP | SSRF + DNS pinning, redirect safety, egress policy, redacted typed errors, retries/circuit/bulkhead, cache, metrics — on by default |

## What "secure by default" actually means

| Concern | Neutrx default |
| --- | --- |
| SSRF / private IPs | Blocked under `strict` and `standard` (DNS-pinned, TOCTOU-safe) |
| Cloud metadata IPs | Blocked (`169.254.169.254`, `100.100.100.200`, `fd00:ec2::254`) |
| Redirect credential leak | `Authorization`/`Cookie`/`Proxy-Authorization` stripped on cross-origin hops |
| HTTPS→HTTP downgrade on redirect | Blocked when HTTPS is enforced |
| Dangerous ports | 22/23/25/53/110/143/3306/5432/6379/27017/11211 blocked |
| Secret logging | `toJSON()` redacts auth/cookie/token/password/secret/api-key |
| Runaway responses | `maxContentLength` (50 MB) and `timeout` (30 s) caps |
| Retry storms | Idempotent-only retries + retry budgets + circuit breaker |

See [Security Features](security-features.md) for exact per-profile values.

## The promise

Axios-like ergonomics for Node.js backends — with SSRF protection, redirect safety, redacted typed errors, retries, circuit breaking, caching, metrics, and observability built in, and nothing required at runtime.

Ready? → [Getting Started](getting-started.md)
