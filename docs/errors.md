---
title: Errors
parent: Reference
nav_order: 3
---

# Errors
{: .no_toc }

1. TOC
{:toc}

---

Every Neutrx failure is a typed, branded, machine-readable `NeutrxError` subclass with a stable `code`, a stable `category`, and a redacting `toJSON()`.

```ts
import { NeutrxHTTPError, isNeutrxError, toStructuredError } from 'neutrx';

try {
  await api.get('/users');
} catch (error) {
  if (!isNeutrxError(error)) throw error;

  console.error(error.code, error.category);
  console.error(error.toJSON()); // safe for logs — secrets redacted

  if (error instanceof NeutrxHTTPError) {
    console.error(error.status, error.retryAfter);
  }
}

// Works on any thrown value, even non-Neutrx errors:
console.error(toStructuredError(new Error('third-party failure')));
```

The default client exposes the same guard as `neutrx.isNeutrxError(error)`.

## Base shape

Every error carries these fields:

| Field | Type | Notes |
| --- | --- | --- |
| `code` | `string` | Stable machine code (e.g. `SSRF_BLOCKED`) |
| `category` | `NeutrxErrorCategory` | One of the categories below |
| `message` | `string` | Human-readable summary |
| `timestamp` | `string` | ISO 8601 |
| `requestId` | `string \| null` | Correlates with `response.requestId` |
| `url` / `method` | `string \| null` | Target (redacted in `toJSON`) |
| `retryable` | `boolean` | Whether the engine considers it retryable |
| `context` | object | Extra diagnostics (redacted) |
| `traceContext` | object? | `traceId` / `spanId` when tracing is active |
| `duration` | number? | Elapsed ms |

`toJSON()` is built for structured logs: it returns `name`, `code`, `category`, `message`, `timestamp`, `requestId`, `url`, `method`, `retryable`, `duration`, `traceId`, `spanId`, redacted `context`, and a redacted `cause` when present. Subclasses add their own fields (HTTP `status`, `retryAfter`, timeout `phase`, response `headers`/`data`, retry `attempts`, body `size`/`limit`).

## Categories

Use **categories** for dashboards and alerts; use the specific **code** for diagnosis.

| Category | Covers |
| --- | --- |
| `network` | DNS failure, connection refused/reset, unreachable |
| `timeout` | Connect / response timeouts |
| `http` | 4xx / 5xx responses |
| `security` | SSRF, cert pins, injection, prototype pollution, rate limit, protocol violations |
| `resilience` | Circuit breaker, retry exhaustion, bulkhead |
| `validation` | Request / response schema failures |
| `limits` | Request / response size violations |
| `unknown` | Anything else |

## Error hierarchy

```
NeutrxError                          (base)
├─ NeutrxNetworkError                category: network
│  ├─ NeutrxConnectionRefusedError   ECONNREFUSED
│  └─ NeutrxDNSError                  ENOTFOUND
├─ NeutrxTimeoutError                category: timeout
│  ├─ NeutrxConnectTimeoutError      CONNECT_TIMEOUT     (phase: 'connect')
│  └─ NeutrxResponseTimeoutError     RESPONSE_TIMEOUT    (phase: 'response')
├─ NeutrxHTTPError                   category: http
│  ├─ NeutrxClientError              HTTP_4XX  (status, retryAfter)
│  └─ NeutrxServerError              HTTP_5XX  (status, retryAfter)
├─ NeutrxSecurityError               category: security
│  ├─ NeutrxSSRFError                SSRF_BLOCKED
│  ├─ NeutrxCertPinError             CERT_PIN_MISMATCH
│  ├─ NeutrxInjectionError           INJECTION_DETECTED
│  ├─ NeutrxPrototypePollutionError  PROTOTYPE_POLLUTION
│  └─ NeutrxRateLimitError           RATE_LIMIT_EXCEEDED
├─ NeutrxCircuitBreakerError         CIRCUIT_OPEN        category: resilience (retryAfter)
├─ NeutrxMaxRetriesError             MAX_RETRIES_EXCEEDED category: resilience (attempts, lastError)
├─ NeutrxBulkheadError               BULKHEAD_FULL | BULKHEAD_QUEUE_TIMEOUT  category: resilience
├─ NeutrxValidationError             REQUEST_VALIDATION_FAILED | RESPONSE_VALIDATION_FAILED  (phase, issues)
├─ NeutrxRequestSizeError            REQUEST_TOO_LARGE   category: limits (size, limit)
└─ NeutrxResponseSizeError           RESPONSE_TOO_LARGE  category: limits (size, limit)
```

All of these are exported from `neutrx` and `neutrx/errors`.

## Common codes

| Code | Meaning |
| --- | --- |
| `SSRF_BLOCKED` | Target resolved to a blocked address/host |
| `HTTPS_REQUIRED` | HTTPS enforced but URL was `http:` |
| `URL_CREDENTIALS_BLOCKED` | `user:pass@host` rejected outside `legacy` |
| `CONNECT_TIMEOUT` / `RESPONSE_TIMEOUT` | Handshake / response deadline exceeded |
| `ECONNABORTED` | Request timeout (Axios-compatible default) |
| `ETIMEDOUT` | Request timeout when `transitional.clarifyTimeoutError: true` |
| `REQUEST_TOO_LARGE` / `RESPONSE_TOO_LARGE` | Size cap exceeded |
| `REQUEST_VALIDATION_FAILED` / `RESPONSE_VALIDATION_FAILED` | Schema validation failed |
| `CIRCUIT_OPEN` | Circuit breaker open |
| `BULKHEAD_FULL` / `BULKHEAD_QUEUE_TIMEOUT` | Concurrency limiter saturated |
| `HTTP_4XX` / `HTTP_5XX` | HTTP error status |

## Redaction

`toJSON()` redacts common secret fields — `authorization`, `cookie`, `token`, `password`, `secret`, `api-key`, `proxy-authorization`, `idempotency-key` — from URLs (including query params and `user:pass`), headers, response data, and the recursively-walked `context`. Add custom patterns with the `redact` request option.

{: .danger }
> Never log raw error objects with embedded request configs if logs may leave the service boundary. Always prefer `error.toJSON()` or `toStructuredError(error)`.

`toStructuredError(error)` gives loggers a safe common representation even when an adapter, interceptor, or third-party library throws a non-Neutrx error — it infers a category from the error code where possible.

## Validation errors

`NeutrxValidationError` exposes `phase` (`'request'` | `'response'`) and normalized `issues` (`{ path, message }[]`). `toJSON()` includes redacted issue messages and paths. See response [schema validation](api.md) and the [validation plugin](plugins.md).

## See also

- [API Reference → Errors](api.md) · [Getting Started → Handle errors safely](getting-started.md)
- [Security Features → Error redaction](security-features.md)
</content>
