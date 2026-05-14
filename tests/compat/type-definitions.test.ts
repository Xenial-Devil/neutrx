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
  fetchAdapter,
  http2Adapter,
  type ClientConfig,
  type FormSerializerOptions,
  type InstrumentationConfig,
  type NeutrxResponse,
  type ProxyConfig,
  type RequestConfig,
} from 'neutrx';

const headers = new NeutrxHeaders({ 'content-type': 'application/json' })
  .setBearerAuth('token')
  .setAccept('application/json');

const formSerializer: FormSerializerOptions = { dots: true, indexes: false, metaTokens: true, maxDepth: 4 };
const instrumentation: InstrumentationConfig = { openTelemetry: true, tracerName: 'types', propagateTraceHeaders: true };
const proxy: ProxyConfig = { host: 'proxy.example.com', port: 8080, auth: { username: 'u', password: 'p' } };
const config: ClientConfig = {
  baseURL: 'https://api.example.com',
  headers: headers.toJSON(),
  formSerializer,
  instrumentation,
  proxy,
  httpVersion: '2',
  http2Options: { sessionTimeout: 1000, maxSessions: 2, rejectUnauthorized: true },
  adapter: 'http2',
};
const request: RequestConfig<FormData> = {
  url: '/upload',
  method: 'POST',
  data: new FormData(),
  adapter: 'fetch',
  credentials: 'include',
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
  withXSRFToken: true,
};
const response: Promise<NeutrxResponse<{ readonly ok: boolean }>> = neutrx.get('/health', {
  ...config,
  adapter: inner => ({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    data: Buffer.from(JSON.stringify({ ok: true })),
    config: inner,
  }),
});
void request;
void response;
void fetchAdapter;
void http2Adapter;
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
