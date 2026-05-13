# Neutrx

Neutrx is a security-first TypeScript HTTP client for Node.js. It keeps the daily API simple like axios while adding safer defaults: SSRF guardrails, input/output sanitization, retries, circuit breaking, bulkhead isolation, caching, metrics, interceptors, OAuth2, GraphQL, mocks, streaming, uploads, downloads, SSE, and concurrency helpers.

## Highlights

- Axios-style default client and configured instances.
- Strict TypeScript API with generated declaration files.
- Secure defaults for HTTPS, SSRF protection, private IP blocking, header validation, certificate validation, and response sanitization.
- Retry engine with fixed, linear, exponential, and Fibonacci strategies.
- Circuit breaker and bulkhead isolation for safer outbound calls under load.
- In-memory GET cache with HTTP cache header support.
- Upload progress callbacks, including real-time streamed upload progress.
- Metrics snapshots and Prometheus output.
- Request/response interceptors and plugin hooks.
- Built-in OAuth2, GraphQL, and mock plugins.
- Dependency-free runtime built on native Node.js HTTP/HTTPS modules.

## Requirements

- Node.js 22 or newer.
- TypeScript 5.6 or newer for development.

## Installation

```bash
# Install Neutrx in an application project.
npm install neutrx # Installs Neutrx as a dependency.
```

For this repository:

```bash
# Install this repository's dependencies.
npm install # Installs packages from package-lock.json.
# Run typecheck, build, and tests together.
npm run validate # Verifies the repository end to end.
```

## Quick Start

Use the default client directly:

```ts
import neutrx from 'neutrx'; // Imports the default Neutrx client.

const users = await neutrx.get('https://api.example.com/users'); // Sends a GET request and returns a typed response.
const created = await neutrx.post('https://api.example.com/users', { // Sends a POST request with a JSON body.
  name: 'Ada Lovelace', // Sends this field in the request body.
}); // Ends the POST request body.
const direct = await neutrx('https://api.example.com/users'); // Calls the client directly; defaults to GET.
const configured = await neutrx({ // Calls the client with a full request config object.
  url: 'https://api.example.com/users', // Sets the request URL.
  method: 'GET', // Sets the HTTP method.
  params: { page: 1 }, // Adds query string params.
}); // Ends the configured request.
```

## Configure Once, Use Everywhere

Create one configured instance in a separate file:

```ts
// src/api.ts // Suggested file for one shared API client.
import neutrx, { GraphQLPlugin, OAuth2Plugin } from 'neutrx'; // Imports the client factory and optional plugins.

const api = neutrx.create({ // Creates one reusable configured client instance.
  baseURL: 'https://api.example.com', // Prefixes all relative URLs like /users.
  timeout: 15_000, // Limits total response wait time to 15 seconds.
  connectTimeout: 5_000, // Limits socket connection time to 5 seconds.
  headers: { // Defines headers sent on every request.
    Accept: 'application/json', // Tells servers JSON is preferred.
  }, // Ends default headers.
  security: { // Enables and tunes security guardrails.
    enforceHTTPS: true, // Requires HTTPS in production.
    validateCertificate: true, // Verifies TLS certificates.
    enableSSRFProtection: true, // Blocks SSRF-style unsafe targets.
    blockPrivateIPs: true, // Blocks localhost/private/internal IP targets.
    sanitizeInputs: true, // Removes unsafe keys and strings from request bodies.
    sanitizeOutputs: true, // Sanitizes unsafe response data.
    rateLimit: { // Configures client-side rate limiting.
      enabled: true, // Turns the rate limiter on.
      maxRequests: 100, // Allows 100 requests per window.
      windowMs: 60_000, // Uses a 60-second window.
      algorithm: 'sliding_window', // Uses sliding window rate limiting.
    }, // Ends rate-limit config.
  }, // Ends security config.
  resilience: { // Enables failure-handling features.
    enableRetry: true, // Retries transient failures.
    maxRetries: 3, // Tries up to 3 retries.
    retryStrategy: 'exponential', // Waits longer after each retry.
    retryDelay: 1000, // Starts retry delay at 1 second.
    enableCircuitBreaker: true, // Stops calling failing services temporarily.
    failureThreshold: 5, // Opens circuit after 5 failures.
    enableBulkhead: true, // Isolates concurrent load per target.
    maxConcurrent: 20, // Allows 20 concurrent requests per bulkhead.
  }, // Ends resilience config.
  performance: { // Enables performance features.
    enableCaching: true, // Caches GET responses.
    cacheTTL: 300_000, // Keeps cache entries for 5 minutes.
  }, // Ends performance config.
}); // Finishes client creation.

api.use(OAuth2Plugin).use(GraphQLPlugin); // Adds OAuth2 and GraphQL helpers to the instance.
api.setAuth({ bearer: process.env.API_TOKEN ?? '' }); // Adds a bearer token when available.

export default api; // Exports the configured instance for the rest of the app.
```

Then import and use it anywhere:

```ts
import api from './api.js'; // Imports the shared configured client.

const users = await api.get('/users'); // GET /users using the baseURL.
const user = await api.get('/users/1'); // GET one user by ID.
const created = await api.post('/users', { name: 'Alan Turing' }); // POST a JSON body to create a user.
const replaced = await api.put('/users/1', { name: 'Grace Hopper' }); // PUT a full replacement for one user.
const updated = await api.patch('/users/1', { name: 'Grace Hopper' }); // PATCH a partial update for one user.
const removed = await api.delete('/users/1'); // DELETE one user by ID.
```

The same instance is also callable:

```ts
const users = await api('/users'); // Calls the instance directly; defaults to GET.
const page = await api({ // Calls the instance with a config object.
  url: '/users', // Uses the configured baseURL plus this path.
  method: 'GET', // Sets HTTP method.
  params: { page: 1, limit: 20 }, // Adds pagination query params.
}); // Ends request config.
```

## Request Methods

```ts
await api.get('/users'); // Sends GET request.
await api.post('/users', { name: 'Ada' }); // Sends POST request with body.
await api.put('/users/1', { name: 'Ada' }); // Sends PUT request with body.
await api.patch('/users/1', { name: 'Ada Lovelace' }); // Sends PATCH request with body.
await api.delete('/users/1'); // Sends DELETE request.
await api.head('/health'); // Sends HEAD request for headers only.
await api.options('/health'); // Sends OPTIONS request for allowed methods/metadata.
await api.request({ url: '/users', method: 'GET' }); // Sends request from full config.
```

## Request Config

```ts
const response = await api.get('/users', { // Sends GET /users with extra options.
  params: { role: 'admin' }, // Adds ?role=admin to the URL.
  headers: { 'X-Trace-ID': 'trace-123' }, // Adds request-specific header.
  timeout: 10_000, // Overrides response timeout for this request.
  connectTimeout: 3_000, // Overrides socket connect timeout for this request.
  responseType: 'json', // Parses response as JSON when possible.
  validateStatus: status => status >= 200 && status < 500, // Treats 2xx-4xx as non-throwing.
  cache: true, // Allows GET cache for this request.
}); // Ends request config.
```

Useful config fields:

- `baseURL`: base URL for relative paths.
- `params`: query string values.
- `headers`: request headers.
- `data`: request body.
- `timeout`: response timeout in milliseconds.
- `connectTimeout`: socket connect timeout in milliseconds.
- `maxRedirects`: redirect limit.
- `maxContentLength`: response size limit in bytes.
- `responseType`: `json`, `text`, `buffer`, or `stream`.
- `validateStatus`: custom success status function.
- `cache`: set `false` to skip GET cache.
- `signal`: AbortController signal.
- `onUploadProgress`: upload progress callback.

## Upload Progress

Yes, upload progress is supported.

For buffers, strings, JSON bodies, and URLSearchParams, Neutrx reports completion when the body is written. For streams, Neutrx reports progress as chunks are written. If `Content-Length` is provided, progress includes `total` and `percent`; otherwise it reports `loaded` bytes only.

```ts
import { createReadStream, statSync } from 'node:fs'; // Imports file stream and file-size helpers.
import api from './api.js'; // Imports the shared configured client.

const filePath = './video.mp4'; // Stores the file path to upload.
const fileSize = statSync(filePath).size; // Reads file size for Content-Length and percent calculation.

await api.upload('/uploads/video', createReadStream(filePath), { // Uploads the file stream to the server.
  headers: { // Sets upload-specific headers.
    'Content-Type': 'video/mp4', // Tells server the uploaded file type.
    'Content-Length': fileSize, // Tells Neutrx/server total bytes for progress percent.
  }, // Ends upload headers.
  onUploadProgress(progress) { // Runs every time upload progress changes.
    if (progress.percent !== undefined) { // Checks whether percent can be calculated.
      console.log(`${progress.percent}% complete`); // Prints percentage progress.
      return; // Stops this callback after printing percent.
    } // Ends percent check.

    console.log(`${progress.loaded} bytes uploaded`); // Prints bytes when total size is unknown.
  }, // Ends progress callback.
}); // Ends upload request.
```

Progress event shape:

```ts
{ // Upload progress event object.
  loaded: number; // Bytes written by the request stream.
  total?: number; // Total upload size when Content-Length is known.
  percent?: number; // Percentage when total is known.
} // End of event shape.
```

Note: progress means bytes written by the Node.js request stream. The server may still be processing the body after the client finishes writing.

## Download

```ts
const file = await api.download('/exports/report.pdf'); // Downloads response as a Buffer.
await writeFile('./report.pdf', file.data); // Writes the downloaded Buffer to disk.
```

For streaming downloads:

```ts
const response = await api.get('/exports/report.pdf', { // Requests a file as a stream.
  responseType: 'stream', // Returns the raw IncomingMessage stream.
}); // Ends download config.

response.data.pipe(createWriteStream('./report.pdf')); // Pipes stream data into a local file.
```

## Authentication

Bearer token:

```ts
api.setAuth({ bearer: process.env.API_TOKEN ?? '' }); // Adds Authorization: Bearer <token>.
```

Basic auth:

```ts
api.setAuth({ // Configures Authorization header.
  basic: { // Chooses Basic auth mode.
    username: 'user', // Sets Basic auth username.
    password: 'pass', // Sets Basic auth password.
  }, // Ends Basic auth credentials.
}); // Applies Basic auth.
```

API key:

```ts
api.setAuth({ // Configures API key auth.
  apiKey: { // Chooses API key auth mode.
    key: process.env.API_KEY ?? '', // Reads API key from environment.
    header: 'X-Api-Key', // Sends key in this header.
  }, // Ends API key config.
}); // Applies API key auth.
```

Clear auth:

```ts
api.clearAuth(); // Removes Authorization header managed by Neutrx.
```

## OAuth2 Plugin

```ts
import api from './api.js'; // Imports configured client.
import { OAuth2Plugin } from 'neutrx'; // Imports OAuth2 plugin.

api.use(OAuth2Plugin); // Installs OAuth2 support.

api.configureOAuth2?.({ // Configures token fetching if plugin is installed.
  tokenURL: 'https://auth.example.com/token', // Token endpoint URL.
  clientId: process.env.CLIENT_ID, // OAuth2 client ID.
  clientSecret: process.env.CLIENT_SECRET, // OAuth2 client secret.
  scope: 'read write', // Requested OAuth2 scopes.
}); // Ends OAuth2 config.
```

The plugin automatically fetches and refreshes tokens, then injects the `Authorization` header.

## GraphQL Plugin

```ts
import api from './api.js'; // Imports configured client.
import { GraphQLPlugin } from 'neutrx'; // Imports GraphQL plugin.

api.use(GraphQLPlugin); // Installs api.gql helper.

const result = await api.gql?.<{ user: { id: string; name: string } }>( // Sends typed GraphQL request if helper exists.
  '/graphql', // GraphQL endpoint path.
  'query GetUser($id: ID!) { user(id: $id) { id name } }', // GraphQL query document.
  { id: '123' } // GraphQL variables object.
); // Ends GraphQL call.

console.log(result?.data.user.name); // Prints returned user name when result exists.
```

## Mock Plugin

Use mocks for tests, examples, and local development without network calls.

```ts
import neutrx, { MockPlugin } from 'neutrx'; // Imports client factory and mock plugin.

const api = neutrx.create({ baseURL: 'https://api.example.com' }); // Creates a client with base URL.

api.use(MockPlugin); // Installs mock support.
api.mock?.enable() // Turns mocks on if plugin is installed.
  .register('/health', { status: 200, data: { ok: true } }) // Returns fake health response.
  .register('/users', { status: 200, data: [{ id: 1, name: 'Ada' }] }); // Returns fake users response.

const health = await api.get('/health'); // Reads mocked health response.
```

## Interceptors

```ts
const requestId = api.useRequest(config => { // Registers request interceptor and stores its ID.
  return { // Returns modified request config.
    ...config, // Keeps existing request config values.
    headers: { // Rebuilds headers object.
      ...config.headers, // Keeps existing headers.
      'X-App-Version': '1.0.0', // Adds app version header.
    }, // Ends headers object.
  }; // Ends modified config.
}); // Ends request interceptor.

api.useResponse(response => { // Registers response interceptor.
  console.log(response.status, response.timing.duration); // Logs status and duration.
  return response; // Returns response so chain continues.
}); // Ends response interceptor.

api.eject(requestId); // Removes interceptor by ID.
```

## Resilience

Retries, circuit breaker, and bulkhead isolation are enabled by default.

```ts
const api = neutrx.create({ // Creates a client with custom resilience settings.
  resilience: { // Groups failure-handling config.
    enableRetry: true, // Enables retry behavior.
    maxRetries: 3, // Allows up to 3 retries.
    retryStrategy: 'exponential', // Uses exponential backoff.
    retryDelay: 1000, // Starts retry delay at 1 second.
    retryableStatuses: [408, 429, 500, 502, 503, 504], // Retries these HTTP statuses.
    enableCircuitBreaker: true, // Enables circuit breaker.
    failureThreshold: 5, // Opens circuit after 5 failures.
    circuitTimeout: 60_000, // Keeps circuit open for 60 seconds.
    enableBulkhead: true, // Enables concurrency isolation.
    maxConcurrent: 10, // Allows 10 active requests per bulkhead.
    maxQueue: 100, // Allows 100 queued requests per bulkhead.
  }, // Ends resilience config.
}); // Ends client creation.
```

Available retry strategies:

- `fixed`
- `linear`
- `exponential`
- `fibonacci`

## Security

Security guardrails are enabled by default:

- HTTPS enforcement in production.
- TLS certificate validation.
- SSRF protection.
- Private/internal host blocking.
- Dangerous port blocking.
- URL injection checks.
- Header injection checks.
- Header count and size limits.
- Prototype pollution key removal.
- Response sanitization.
- Certificate pinning.
- Optional request signing.

Certificate pinning:

```ts
api.pinCertificate( // Pins a TLS certificate fingerprint for one host.
  'api.example.com', // Hostname to pin.
  '8f14e45fceea167a5a36dedd4bea2543f8f14e45fceea167a5a36dedd4bea2543' // SHA-256 certificate fingerprint.
); // Applies certificate pin.
```

Block a domain:

```ts
api.blockDomain('malicious.example'); // Blocks requests to this domain.
```

Enable request signing:

```ts
api.enableRequestSigning(process.env.SIGNING_SECRET ?? ''); // Signs outbound requests with shared secret.
```

For trusted local development against localhost, explicitly relax the local-only security settings:

```ts
const localApi = neutrx.create({ // Creates local-development client.
  baseURL: 'http://127.0.0.1:3000', // Points to local server.
  security: { // Overrides security checks for trusted local dev only.
    enforceHTTPS: false, // Allows HTTP.
    enableSSRFProtection: false, // Allows local/private addresses.
    blockPrivateIPs: false, // Allows 127.0.0.1/private IPs.
  }, // Ends local security overrides.
}); // Ends local client creation.
```

## Caching

GET caching is enabled by default.

```ts
const first = await api.get('/users'); // Fetches users and stores cache entry.
const second = await api.get('/users'); // Reads users from cache when still valid.

console.log(api.getCacheStats()); // Prints cache hit/miss stats.
api.clearCache(); // Clears all cache entries.
```

Skip cache per request:

```ts
await api.get('/users', { cache: false }); // Forces network request and skips cache.
```

## Concurrency Helpers

Run requests concurrently:

```ts
const { results, errors, completed } = await api.concurrent([ // Runs multiple requests with one helper.
  { method: 'GET', url: '/users' }, // First concurrent request.
  { method: 'GET', url: '/products' }, // Second concurrent request.
  () => ({ method: 'GET', url: '/orders' }), // Lazy request factory.
], { // Starts concurrency options.
  limit: 5, // Runs at most 5 requests at once.
  failFast: false, // Keeps going after individual failures.
  onProgress(done, total) { // Runs after each request finishes.
    console.log(`${done}/${total}`); // Prints completion count.
  }, // Ends progress callback.
}); // Ends concurrent call.
```

Run sequentially:

```ts
const responses = await api.sequential([ // Runs requests one after another.
  { method: 'GET', url: '/auth/session' }, // First request.
  previous => ({ // Builds next request from previous response.
    method: 'GET', // Uses GET for second request.
    url: `/users/${previous?.data}`, // Uses previous response data in URL.
  }), // Ends request factory.
]); // Ends sequential call.
```

Race or hedge requests:

```ts
const fastest = await api.race([ // Starts multiple requests and returns first success/resolution.
  { method: 'GET', url: 'https://region-a.example.com/data' }, // Region A request.
  { method: 'GET', url: 'https://region-b.example.com/data' }, // Region B request.
]); // Ends race call.

const hedged = await api.hedged([ // Starts backup requests after a delay to reduce tail latency.
  { method: 'GET', url: 'https://primary.example.com/data' }, // Primary request.
  { method: 'GET', url: 'https://backup.example.com/data' }, // Backup request.
], { delay: 250 }); // Starts backup after 250ms.
```

## Pagination

```ts
for await (const page of api.paginate('/users', { // Iterates through paginated API responses.
  pageParam: 'page', // Query param name for page number.
  limitParam: 'limit', // Query param name for page size.
  pageSize: 50, // Requests 50 records per page.
  dataPath: 'data', // Reads page items from response.data.
  hasMorePath: 'hasMore', // Reads continuation flag from response.hasMore.
})) { // Starts loop body for each page.
  console.log(page.page, page.data); // Prints page number and page data.
} // Ends pagination loop.
```

## SSE

```ts
const stream = await api.sse('/events', { // Opens server-sent events stream.
  onMessage(message) { // Handles each incoming SSE message.
    console.log(message); // Prints message payload.
  }, // Ends message handler.
  onError(error) { // Handles stream errors.
    console.error(error.message); // Prints error message.
  }, // Ends error handler.
  onClose() { // Handles stream close.
    console.log('closed'); // Prints close notice.
  }, // Ends close handler.
}); // Ends SSE setup.

stream.close(); // Manually closes SSE connection.
```

## Metrics

```ts
console.log(api.getMetrics()); // Prints structured metrics snapshot.
console.log(api.getMetricsPrometheus()); // Prints Prometheus-format metrics.
console.log(api.getCircuitStatus()); // Prints circuit breaker status.
console.log(api.getBulkheadStats()); // Prints bulkhead concurrency stats.

api.resetMetrics(); // Clears collected metrics.
```

## Events

```ts
api.on('request:success', event => { // Listens for successful requests.
  console.log(event); // Prints success event payload.
}); // Ends success listener.

api.on('request:error', event => { // Listens for failed requests.
  console.error(event); // Prints error event payload.
}); // Ends error listener.

api.on('cache:hit', event => { // Listens for cache hits.
  console.log(event); // Prints cache-hit event payload.
}); // Ends cache listener.
```

## Response Shape

```ts
const response = await api.get('/users'); // Gets a response object.

response.status; // HTTP status code.
response.statusText; // HTTP status text.
response.headers; // Response headers.
response.data; // Parsed response body.
response.config; // Final internal request config.
response.timing.duration; // Request duration in milliseconds.
response.requestId; // Unique request ID.
response.attempts; // Retry attempt metadata when retries ran.
response.cached; // True when response came from cache.
response.cacheAge; // Cache age when response came from cache.
```

## Errors

Neutrx exports typed errors:

```ts
import { // Imports typed error classes.
  NeutrxError, // Base Neutrx error class.
  NeutrxHTTPError, // HTTP status error class.
  NeutrxTimeoutError, // Timeout error class.
  NeutrxSSRFError, // SSRF protection error class.
} from 'neutrx'; // Imports errors from package.

try { // Starts error-handled request block.
  await api.get('/users'); // Sends request that may throw.
} catch (error) { // Handles any thrown error.
  if (error instanceof NeutrxHTTPError) { // Checks for HTTP status error.
    console.error(error.status, error.response?.data); // Prints status and response body.
  } else if (error instanceof NeutrxTimeoutError) { // Checks for timeout error.
    console.error('timeout'); // Prints timeout message.
  } else if (error instanceof NeutrxSSRFError) { // Checks for SSRF block.
    console.error('blocked unsafe URL'); // Prints SSRF block message.
  } else if (error instanceof NeutrxError) { // Checks for other Neutrx errors.
    console.error(error.code, error.message); // Prints Neutrx error code and message.
  } // Ends error type checks.
} // Ends catch block.
```

## Repository Layout

```text
neutrx/
  examples/              TypeScript usage examples
  src/
    core/                Client, callable facade, and error classes
    interceptors/        Request and response interceptor chain
    monitoring/          Metrics collector
    performance/         Cache engine
    plugins/             Plugin manager and built-in plugins
    resilience/          Retry, circuit breaker, and bulkhead modules
    security/            Security manager and rate limiter
    index.ts             Public package entrypoint
    types.ts             Shared public/internal types
  tests/                 TypeScript smoke tests
```

## Development

```bash
# Type-check the TypeScript project.
npm run typecheck # Runs TypeScript without emitting files.
# Run ESLint rules.
npm run lint # Checks code style and unsafe TypeScript patterns.
# Compile and run tests.
npm test # Builds test output and runs node:test.
# Run typecheck, build, and tests.
npm run validate # Runs the main validation pipeline.
```

Build:

```bash
# Compile library files into dist/.
npm run build # Emits compiled package files.
```

Start smoke check:

```bash
# Load built package entrypoint.
npm run start # Runs the package smoke start command.
```

## TypeScript Notes

- `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` are enabled.
- Public request/response APIs are generic.
- Runtime external data is represented with JSON-safe types, buffers, or streams.
- Error handling uses `unknown` only at catch boundaries, then normalizes to `Error`.
- Generated types come from `dist/**/*.d.ts`.

## Environment Variables

Neutrx itself does not require environment variables. Examples may use:

```bash
# Optional bearer token used by examples.
API_TOKEN= # Optional bearer token used by examples.
# Optional OAuth2 client ID used by examples.
CLIENT_ID= # Optional OAuth2 client ID used by examples.
# Optional OAuth2 client secret used by examples.
CLIENT_SECRET= # Optional OAuth2 client secret used by examples.
# Optional signing secret used by request-signing examples.
SIGNING_SECRET= # Optional signing secret used by request-signing examples.
```

Keep secrets in `.env` or your deployment secret manager. Do not commit secret files.

## Troubleshooting

- `Cannot find module dist/index.js`: run `npm run build`.
- Editor shows stale TypeScript errors: restart the TypeScript server or reload VS Code.
- Localhost requests fail: SSRF/private IP protection is enabled by default. Disable it only for trusted local development.
- HTTP URLs fail in production: HTTPS enforcement is enabled in production.
- Upload progress has no percent: provide `Content-Length` so Neutrx can calculate total percent.

## License and Ownership

This project is privately owned. See [LICENSE](./LICENSE). No copying, forking, modification, redistribution, publication, commercial use, or other use is allowed without prior written permission from the owner.
