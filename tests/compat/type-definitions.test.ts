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
  CancelToken,
  NeutrxValidationError,
  OpenTelemetryInstrumentation,
  HttpAdapter,
  createSecureAdapter,
  fetchAdapter,
  http2Adapter,
  nodeHttpAdapter,
  getHttp2SessionStats,
  createOtelPlugin,
  isCancel,
  isNeutrxError,
  LogPlugin,
  OtelPlugin,
  ValidationPlugin,
  WebSocketPlugin,
  type AdaptiveConcurrencyConfig,
  type CacheStore,
  type CancelTokenSource,
  type CertificatePinConfig,
  type CircuitStateStore,
  type ClientConfig,
  type EgressPolicyConfig,
  type FormSerializerOptions,
  type InferValidationSchema,
  type InstrumentationConfig,
  type NeutrxLogger,
  type NeutrxAdapter,
  type NeutrxInstance,
  type NeutrxRequestConfig,
  type NeutrxResponse,
  type NeutrxWSConnection,
  type OtelPluginOptions,
  type ProxyConfig,
  type RawHttpResponse,
  type RequestConfig,
  type RequestInterceptorOptions,
  type ResponseValidationSchema,
  type RetryBudgetStore,
  type ServiceDiscoveryConfig,
  type ServiceEndpoint,
  type ServiceResolver,
  type TlsConfig,
  type TransitionalConfig,
  type ValidationPluginConfig,
  type ValidationSchema,
} from 'neutrx';
import type { NeutrxError as NeutrxErrorType } from 'neutrx/errors';
import type { NeutrxPlugin as NeutrxPluginType } from 'neutrx/plugins';

const headers = new NeutrxHeaders({ 'content-type': 'application/json' })
  .setBearerAuth('token')
  .setAccept('application/json')
  .setUserAgent('neutrx-types')
  .setContentType(null)
  .setAuthorization(false);
const authHeader: string | undefined = headers.getAuthorization();
for (const [headerName, headerValue] of headers) {
  void headerName;
  void headerValue;
}

const formSerializer: FormSerializerOptions = { dots: true, indexes: false, metaTokens: true, maxDepth: 4 };
const instrumentation: InstrumentationConfig = { openTelemetry: true, tracerName: 'types', propagateTraceHeaders: true };
const otelPluginOptions: OtelPluginOptions = { tracerName: 'created-plugin', propagateTraceHeaders: false };
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
const cancelSource: CancelTokenSource = CancelToken.source();
const userResponseSchema: ValidationSchema = {
  safeParse: value => ({ success: true, data: value }),
};
const firstClassUserSchema = {
  safeParse(value: unknown) {
    return typeof value === 'object' && value !== null && 'id' in value
      ? { success: true as const, data: { id: String((value as { id: unknown }).id), active: true } }
      : { success: false as const, issues: [{ path: ['id'], message: 'id missing' }] };
  },
} satisfies ResponseValidationSchema<{ readonly id: string; readonly active: boolean }>;
type FirstClassUser = InferValidationSchema<typeof firstClassUserSchema>;
const inferredUser: FirstClassUser = { id: 'typed', active: true };
const validation: ValidationPluginConfig = {
  request: () => true,
  response: userResponseSchema,
};
const transitional: TransitionalConfig = { clarifyTimeoutError: true };
const typedAdapter: NeutrxAdapter = (inner: NeutrxRequestConfig): RawHttpResponse => ({
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json' },
  data: Buffer.from(JSON.stringify({ ok: true })),
  config: inner,
});
const logger: NeutrxLogger = {
  info: entry => void entry.requestId,
  error: entry => void entry.code,
};
const config: ClientConfig = {
  baseURL: 'https://api.example.com',
  allowAbsoluteUrls: false,
  auth: { username: 'api-user', password: 'api-pass' },
  idempotencyKey: true,
  idempotencyKeyHeader: 'Idempotency-Key',
  headers,
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
  beforeRedirect: context => {
    context.headers['X-Redirect-Hook'] = 'yes';
  },
  responseEncoding: 'latin1',
  transitional: { clarifyTimeoutError: true },
  adapter: 'http2',
  schema: firstClassUserSchema,
  maxRate: [1024, 2048],
};
neutrx.defaults.baseURL = 'https://defaults.example';
neutrx.defaults.headers = { 'X-Default': 'yes' };
const request: RequestConfig<FormData> = {
  url: '/upload',
  method: 'POST',
  data: new FormData(),
  allowAbsoluteUrls: true,
  auth: { username: 'request-user', password: 'request-pass' },
  idempotencyKey: 'upload-1',
  adapter: 'fetch',
  credentials: 'include',
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
  withXSRFToken: true,
  transitional: { clarifyTimeoutError: false },
  onDownloadProgress: event => {
    const progress: number | undefined = event.progress;
    const bytes: number = event.bytes;
    const rate: number = event.rate;
    const estimated: number | undefined = event.estimated;
    void progress;
    void bytes;
    void rate;
    void estimated;
  },
  cancelToken: cancelSource.token,
  validation,
  schema: false,
  serviceDiscovery: { resolver: ['https://uploads.example.com'], strategy: 'sticky-origin' },
};
cancelSource.cancel('typed cancel');
const rootCancelSource = neutrx.CancelToken.source();
rootCancelSource.cancel('root typed cancel');
const wasCancel = isCancel(cancelSource.token.reason) && neutrx.isCancel(rootCancelSource.token.reason);
neutrx.use(ValidationPlugin);
neutrx.use(LogPlugin);
neutrx.use(OtelPlugin);
neutrx.use(createOtelPlugin(otelPluginOptions));
neutrx.use(WebSocketPlugin);
neutrx.setLogger(logger);
neutrx.enableOpenTelemetry({ tracerName: 'types-plugin' });
neutrx.configureValidation?.(validation);
const ws: NeutrxWSConnection | undefined = neutrx.ws?.('wss://api.example.com/realtime', { reconnect: false });
const validationError = new NeutrxValidationError('response', [{ path: ['id'], message: 'id missing' }]);
const typedClient: NeutrxInstance = neutrx.create(config);
typedClient.defaults.baseURL = 'https://typed-instance.example';
typedClient.defaults.timeout = 2500;
typedClient.defaults.headers.common.Authorization = 'Bearer typed-token';
const interceptorOptions: RequestInterceptorOptions = {
  synchronous: true,
  runWhen: inner => inner.method === 'GET',
};
const requestInterceptorId = typedClient.useRequest(inner => inner, error => error, interceptorOptions);
const managerInterceptorId = typedClient.interceptors.request.use(inner => inner, undefined, {
  runWhen: inner => inner.url.includes('/health'),
});
typedClient.interceptors.request.eject(managerInterceptorId);
typedClient.interceptors.request.clear();
typedClient.interceptors.response.use(inner => inner, error => error);
typedClient.interceptors.response.clear();
typedClient.eject(requestInterceptorId);
const typedPlugin: NeutrxPluginType = LogPlugin;
const typedError: NeutrxErrorType = validationError;
const typedIsNeutrxError: boolean = isNeutrxError(validationError) && neutrx.isNeutrxError(validationError);
const typedUri: string = neutrx.getUri({ url: '/typed', params: { page: 1 } });
const response: Promise<NeutrxResponse<{ readonly ok: boolean }>> = neutrx.get('/health', {
  ...config,
  schema: false,
  adapter: createSecureAdapter(inner => ({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    data: Buffer.from(JSON.stringify({ ok: true })),
    config: inner,
  })),
});
const schemaResponse: Promise<NeutrxResponse<FirstClassUser>> = neutrx.get('/schema', {
  ...config,
  schema: firstClassUserSchema,
  adapter: createSecureAdapter(inner => ({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    data: Buffer.from(JSON.stringify({ id: 'typed' })),
    config: inner,
  })),
});
const encoded = neutrx.postUrlEncoded('/form', { name: 'Ada' });
const postForm = neutrx.postForm('/form', new FormData());
const putForm = typedClient.putForm('/form', { name: 'Grace' });
const patchForm = typedClient.patchForm('/form', { name: 'Katherine' });
const adapterResponse = typedAdapter({
  url: 'https://api.example.com/typed-adapter',
  method: 'GET',
  headers: new NeutrxHeaders() as unknown as NeutrxRequestConfig['headers'],
  timeout: 1000,
  connectTimeout: 1000,
  maxRedirects: 0,
  maxContentLength: 1024,
  maxBodyLength: 1024,
  allowAbsoluteUrls: true,
  responseType: 'json',
  responseEncoding: 'utf8',
  validateStatus: status => status >= 200 && status < 300,
  throwHttpErrors: true,
  decompress: true,
  transitional: { clarifyTimeoutError: true },
  followRedirects: true,
  requestId: 'typed',
  startTime: Date.now(),
  hops: 0,
});
void request;
void authHeader;
void wasCancel;
void validationError;
void typedClient;
void adapterResponse;
void typedPlugin;
void typedError;
void typedIsNeutrxError;
void typedUri;
void response;
void schemaResponse;
void inferredUser;
void encoded;
void postForm;
void putForm;
void patchForm;
void ws;
void HttpAdapter;
void createSecureAdapter;
void fetchAdapter;
void http2Adapter;
void nodeHttpAdapter;
void getHttp2SessionStats;
void OpenTelemetryInstrumentation;
void ValidationPlugin;
void LogPlugin;
void OtelPlugin;
void createOtelPlugin;
void WebSocketPlugin;
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
