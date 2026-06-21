---
title: Auth Token
parent: Examples
nav_order: 2
---

# Auth Token

Use `setAuth()` for service-wide bearer tokens, or pass request-specific headers when each call has a different token.

## Service Token

```ts
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  security: { profile: 'standard' },
});

api.setAuth({
  bearer: process.env.API_TOKEN ?? '',
});

const response = await api.get('/me');
```

## Request-Scoped Token

```ts
export async function fetchTenantProfile(token: string, tenantId: string) {
  return api.get('/tenant/profile', {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': tenantId,
    },
  });
}
```

Cross-origin redirects strip `Authorization` and other sensitive headers before the next hop is followed.
