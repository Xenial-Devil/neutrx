# Errors

Neutrx errors are typed, branded, and machine-readable.

```ts
import { NeutrxHTTPError, isNeutrxError } from 'neutrx';

try {
  await api.get('/users');
} catch (error) {
  if (!isNeutrxError(error)) throw error;

  console.error(error.code, error.toJSON());

  if (error instanceof NeutrxHTTPError) {
    console.error(error.status, error.retryAfter);
  }
}
```

The default client exposes the same guard as `neutrx.isNeutrxError(error)`. `toJSON()` is intended for structured logs: it includes the common fields `name`, `code`, `message`, `timestamp`, `requestId`, `url`, `method`, `retryable`, `duration`, and redacted `context`. Subclasses add relevant machine-readable fields such as HTTP `status`, `retryAfter`, timeout `phase`, security `severity`, response `headers` and `data`, retry `attempts`, or body `size` and `limit`.

Common codes:

- `SSRF_BLOCKED`
- `HTTPS_REQUIRED`
- `URL_CREDENTIALS_BLOCKED`
- `CONNECT_TIMEOUT`
- `RESPONSE_TIMEOUT`
- `ECONNABORTED` (request timeout with Axios-compatible default)
- `ETIMEDOUT` (request timeout when `transitional.clarifyTimeoutError` is `true`)
- `RESPONSE_TOO_LARGE`
- `REQUEST_TOO_LARGE`
- `REQUEST_VALIDATION_FAILED`
- `RESPONSE_VALIDATION_FAILED`
- `CIRCUIT_OPEN`
- `BULKHEAD_FULL`
- `HTTP_429`
- `HTTP_500`

Never log raw errors with embedded configs if logs may leave the service boundary. Prefer `toJSON()`.

`NeutrxValidationError` exposes `phase` and normalized `issues`; `toJSON()` includes redacted issue messages and paths for structured logs.
