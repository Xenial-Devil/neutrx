---
title: File Upload
parent: Examples
nav_order: 3
---

# File Upload

Use form helpers for multipart uploads. In Node, plain objects are serialized as multipart bodies by the Node HTTP adapter. In browser runtimes, plain objects are converted to `FormData` where the platform supports it.

```ts
import { readFile } from 'node:fs/promises';
import neutrx from 'neutrx';

const api = neutrx.create({
  baseURL: 'https://files.example.com',
  timeout: 30_000,
  maxBodyLength: 10 * 1024 * 1024,
  security: {
    profile: 'standard',
    allowedHosts: ['files.example.com'],
  },
});

export async function uploadReport(path: string): Promise<string> {
  const file = await readFile(path);

  const response = await api.postForm<{ readonly id: string }>('/uploads', {
    name: 'monthly-report',
    file,
  }, {
    onUploadProgress(event) {
      console.log(event.loaded, event.total, event.rate);
    },
  });

  return response.data.id;
}
```

Set `maxBodyLength` for expected upload sizes. Keep upload paths and socket paths out of user-controlled request config.
