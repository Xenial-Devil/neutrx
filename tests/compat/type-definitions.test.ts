import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

void test('published TypeScript declarations support public Node API usage', () => {
    const fixtureDir = path.join(process.cwd(), 'dist-tests', 'type-fixtures');
    const fixturePath = path.join(fixtureDir, 'public-api.ts');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(fixturePath, `
import neutrx, {
  NeutrxHeaders,
  OpenTelemetryInstrumentation,
  HttpAdapter,
  createSecureAdapter,
  fetchAdapter,
  http2Adapter,
  getHttp2SessionStats,
  type AdaptiveConcurrencyConfig,
  type CacheStore,
  type CertificatePinConfig,
  type CircuitStateStore,
  type ClientConfig,
  type EgressPolicyConfig,
  type FormSerializerOptions,
  type InstrumentationConfig,
  type NeutrxResponse,
  type ProxyConfig,
  type RequestConfig,
  type RetryBudgetStore,
  type ServiceDiscoveryConfig,
  type ServiceEndpoint,
  type ServiceResolver,
  type TlsConfig,
} from 'neutrx';

const headers = new NeutrxHeaders({ 'content-type': 'application/json' })
  .setBearerAuth('token')
  .setAccept('application/json');

const formSerializer: FormSerializerOptions = { dots: true, indexes: false, metaTokens: true, maxDepth: 4 };
const instrumentation: InstrumentationConfig = { openTelemetry: true, tracerName: 'types', propagateTraceHeaders: true };
const egressPolicy: EgressPolicyConfig = { mode: 'public-api', allowedHosts: ['api.example.com'], allowedPorts: [443] };
const adaptiveConcurrency: AdaptiveConcurrencyConfig = { enabled: true, initialLimit: 5, minLimit: 1, maxLimit: 20 };
const pin: CertificatePinConfig = { hostname: 'api.example.com', sha256: 'a'.repeat(64), expiresAt: Date.now() + 60000 };
const tls: TlsConfig = { ca: 'ca', cert: 'cert', key: 'key', servername: 'api.example.com', certificatePins: [pin] };
const cacheAdapter: CacheStore = {
  get: () => undefined,
  set: () => undefined,
  delete: () => undefined,
  clear: () => undefined,
  keys: () => [],
};
const retryBudgetStore: RetryBudgetStore = {
  consume: () => true,
};
const circuitStateStore: CircuitStateStore = {
  get: () => undefined,
  set: () => undefined,
};
const endpoints: readonly ServiceEndpoint[] = [
  { url: 'https://api-a.example.com', weight: 2, metadata: { zone: 'a' } },
  { url: 'https://api-b.example.com', weight: 1 },
];
const serviceResolver: ServiceResolver = context => Promise.resolve(
  context.method === 'GET' ? endpoints : ['https://write.example.com']
);
const serviceDiscovery: ServiceDiscoveryConfig = {
  resolver: serviceResolver,
  strategy: 'round-robin',
  maxEndpoints: 10,
};
const proxy: ProxyConfig = { host: 'proxy.example.com', port: 8080, auth: { username: 'u', password: 'p' } };
const config: ClientConfig = {
  baseURL: 'https://api.example.com',
  auth: { username: 'api-user', password: 'api-pass' },
  idempotencyKey: true,
  idempotencyKeyHeader: 'Idempotency-Key',
  headers: headers.toJSON(),
  formSerializer,
  instrumentation,
  egressPolicy,
  serviceDiscovery,
  proxy,
  tls,
  httpVersion: '2',
  http2Options: { sessionTimeout: 1000, maxSessions: 2, rejectUnauthorized: true, maxConcurrentStreams: 20 },
  resilience: {
    adaptiveConcurrency,
    retryBudget: { maxRetries: 10, windowMs: 60_000, scope: 'origin', namespace: 'types', store: retryBudgetStore },
    circuitBreakerStorage: { store: circuitStateStore, namespace: 'types' },
  },
  performance: { cacheAdapter },
  adapter: 'http2',
  maxRate: [1024, 2048],
};
neutrx.defaults.baseURL = 'https://defaults.example';
neutrx.defaults.headers = { 'X-Default': 'yes' };
const request: RequestConfig<FormData> = {
  url: '/upload',
  method: 'POST',
  data: new FormData(),
  auth: { username: 'request-user', password: 'request-pass' },
  idempotencyKey: 'upload-1',
  adapter: 'fetch',
  credentials: 'include',
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
  withXSRFToken: true,
  serviceDiscovery: { resolver: ['https://uploads.example.com'], strategy: 'sticky-origin' },
};
const response: Promise<NeutrxResponse<{ readonly ok: boolean }>> = neutrx.get('/health', {
  ...config,
  adapter: createSecureAdapter(inner => ({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    data: Buffer.from(JSON.stringify({ ok: true })),
    config: inner,
  })),
});
const encoded = neutrx.postUrlEncoded('/form', { name: 'Ada' });
void request;
void response;
void encoded;
void HttpAdapter;
void createSecureAdapter;
void fetchAdapter;
void http2Adapter;
void getHttp2SessionStats;
void OpenTelemetryInstrumentation;
`);

    const tscPath = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
    const result = spawnSync(process.execPath, [
        tscPath,
        '--noEmit',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--strict',
        '--skipLibCheck',
        '--types',
        'node',
        fixturePath,
    ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: false,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
