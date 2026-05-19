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

Common codes:

- `SSRF_BLOCKED`
- `HTTPS_REQUIRED`
- `URL_CREDENTIALS_BLOCKED`
- `CONNECT_TIMEOUT`
- `RESPONSE_TIMEOUT`
- `RESPONSE_TOO_LARGE`
- `REQUEST_TOO_LARGE`
- `CIRCUIT_OPEN`
- `BULKHEAD_FULL`
- `HTTP_429`
- `HTTP_500`

Never log raw errors with embedded configs if logs may leave the service boundary. Prefer `toJSON()`.
