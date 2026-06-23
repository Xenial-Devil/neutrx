---
title: REST API Request
description: "Make REST API requests with Neutrx using typed clients, params, JSON bodies, redacted errors, and secure backend defaults."
parent: Examples
nav_order: 1
---

# REST API Request

Create one client for the upstream API, then use verb helpers for each request.

```ts
import neutrx from 'neutrx';

type User = {
  readonly id: string;
  readonly name: string;
};

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
  security: {
    profile: 'standard',
    allowedHosts: ['api.example.com'],
  },
});

export async function listUsers(page = 1): Promise<readonly User[]> {
  const response = await api.get<readonly User[]>('/users', {
    params: { page },
  });

  return response.data;
}

export async function createUser(name: string): Promise<User> {
  const response = await api.post<User>('/users', { name });
  return response.data;
}
```

Request config passed to a call overrides instance defaults for that call only.
