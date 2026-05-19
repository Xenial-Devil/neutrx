# Axios Migration Matrix

This guide maps common Axios backend usage to Neutrx. Neutrx keeps familiar ergonomics where they fit, but preserves backend security defaults over exact compatibility.

| Axios pattern | Neutrx mapping | Same? | Notes |
| --- | --- | --- | --- |
| `axios.create({ baseURL })` | `neutrx.create({ baseURL })` | Yes | Node.js 22+ only |
| `axios.get(url, config)` | `api.get(url, config)` | Yes | Returns `NeutrxResponse` |
| `axios.post(url, data, config)` | `api.post(url, data, config)` | Yes | JSON by default for plain objects |
| `auth: { username, password }` | `auth: { username, password }` | Mostly | Builds `Authorization: Basic ...`; request auth overrides instance auth and is not retained on internal config |
| `params` | `params` | Mostly | Nested objects use bracket keys; arrays repeat by default |
| `paramsSerializer: fn` | `paramsSerializer: fn` | Yes | Function receives full params object |
| `paramsSerializer.indexes: true` | `paramsSerializer: { indexes: true }` | Yes | `tags[0]=a&tags[1]=b` |
| `paramsSerializer.indexes: false` | `paramsSerializer: { indexes: false }` | Yes | `tags[]=a&tags[]=b` |
| `paramsSerializer.indexes: null` | `paramsSerializer: { indexes: null }` | Yes | `tags=a&tags=b` |
| `validateStatus` | `validateStatus` | Yes | Used before throwing HTTP errors |
| Non-2xx returns with custom status handling | `throwHttpErrors: false` | Similar | Neutrx throws by default for invalid status |
| Request interceptors | `api.interceptors.request.use` | Similar | Documented and tested; request chain runs in registration order |
| Response interceptors | `api.interceptors.response.use` | Similar | Response chain runs in registration order |
| `CancelToken` | `AbortController` or `AbortSignal.timeout()` | Different | `CancelToken` is intentionally not in core |
| `onUploadProgress` | `onUploadProgress` | Similar | Node and browser support depend on body/stream visibility |
| `onDownloadProgress` | `onDownloadProgress` | Similar | Stream progress depends on adapter capabilities |
| `FormData` upload | `api.postForm`, `api.putForm`, `api.patchForm` | Similar | Multipart helper sets safe headers |
| URL-encoded forms | `api.postUrlEncoded`, `api.putUrlEncoded`, `api.patchUrlEncoded` | Similar | Plain objects become `application/x-www-form-urlencoded` |
| `adapter` | `adapter: 'http' / 'fetch' / 'http2' / fn` | Similar | Custom adapters should use `createSecureAdapter()` when possible |
| Proxy config | `proxy` | Similar | HTTP proxy and HTTPS CONNECT are Node-only |
| XSRF browser config | `xsrfCookieName`, `xsrfHeaderName`, `withXSRFToken` | Similar | Browser entry only |

## Auth Alias

```ts
const api = neutrx.create({
  baseURL: 'https://api.example.com',
  auth: { username: 'service', password: process.env.API_PASSWORD ?? '' },
});

await api.get('/users', {
  auth: { username: 'request-user', password: 'request-pass' },
});
```

Use `setAuth()` for bearer tokens and API keys:

```ts
api.setAuth({ bearer: process.env.API_TOKEN ?? '' });
api.setAuth({ apiKey: { key: process.env.API_KEY ?? '', header: 'X-Api-Key' } });
```

## URL-Encoded Forms

```ts
await api.postUrlEncoded('/oauth/token', {
  grant_type: 'client_credentials',
  client_id: 'service',
  client_secret: process.env.CLIENT_SECRET ?? '',
});
```

## Unsafe Axios Pattern To Safer Neutrx Pattern

```ts
// Avoid: user-controlled URL with a generic client.
await axios.get(userProvidedUrl);

// Prefer: strict profile plus explicit egress policy.
const previews = neutrx.create({
  security: { profile: 'strict' },
  egressPolicy: { mode: 'webhook-target', allowedPorts: [443] },
});

await previews.get(userProvidedUrl);
```
