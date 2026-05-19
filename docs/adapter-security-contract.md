# Adapter Security Contract

Custom adapters are powerful and risky. Neutrx can validate request config before an adapter runs and parse/redact errors after a response returns, but it cannot inspect redirects, DNS, TLS, proxy behavior, or retries that a custom adapter performs internally.

Use built-in adapters for security-sensitive traffic whenever possible.

## Required Invariants

A custom adapter must:

- Use `config.url` exactly as passed unless it returns control to Neutrx for redirects.
- Not follow redirects internally.
- Not add credentials to cross-origin redirects.
- Not bypass `config.signal`, `config.timeout`, `maxBodyLength`, or `maxContentLength` semantics without documenting why.
- Preserve `config` on the returned `RawHttpResponse`.
- Return headers without CRLF injection.
- Avoid logging raw URLs, headers, or bodies.
- Treat `legacy` security settings as trusted migration-only settings.

## Secure Wrapper

`createSecureAdapter()` adds lightweight invariants around a custom adapter:

```ts
import neutrx, { createSecureAdapter } from 'neutrx';

const api = neutrx.create({
  adapter: createSecureAdapter(async config => {
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      data: Buffer.from('{}'),
      config,
    };
  }),
});
```

The wrapper rejects:

- A response whose `response.config.url` differs from the request URL.
- Redirect responses with a `Location` header unless `allowRedirectResponses` is set.

This wrapper does not make a custom adapter equivalent to Neutrx's Node HTTP adapter. DNS pinning, TLS policy, proxy safety, and redirect-chain validation must still be implemented by the adapter or avoided by using built-in adapters.

## When Not To Use A Custom Adapter

Avoid custom adapters for:

- User-controlled URLs.
- Webhook target fetches.
- Cloud metadata sensitive environments.
- Requests carrying bearer tokens, cookies, or proxy credentials across redirects.

For those cases, prefer `adapter: 'http'` with `security.profile: 'strict'` and an `egressPolicy`.
