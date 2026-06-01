# Docker Socket Request

Use `socketPath` for trusted local HTTP-over-Unix-socket services such as Docker Engine.

```ts
import neutrx from 'neutrx';

const docker = neutrx.create({
  baseURL: 'http://docker',
  socketPath: '/var/run/docker.sock',
  proxy: false,
  timeout: 5_000,
  maxContentLength: 2 * 1024 * 1024,
});

export async function dockerVersion() {
  const response = await docker.get('/v1/version');
  return response.data;
}
```

With `socketPath`, Neutrx connects to the absolute local socket path and uses the URL host only as the HTTP `Host` header. DNS, SSRF, private-IP, HTTPS, and egress-policy network checks do not apply to the synthetic URL host because no TCP connection is made.

Treat `socketPath` as privileged configuration. Never accept it from untrusted input.
