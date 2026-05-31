import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';

type OTelGlobal = typeof globalThis & { __NEUTRX_OTEL_API__?: unknown };
type SpanStatus = { readonly code: number; readonly message?: string };

void test('OpenTelemetry instrumentation creates spans and propagates trace headers', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const attributes: Record<string, string | number | boolean> = {};
    const statuses: Array<{ readonly code: number; readonly message?: string }> = [];
    let endCount = 0;

    (globalThis as OTelGlobal).__NEUTRX_OTEL_API__ = {
        trace: {
            getTracer: () => ({
                startSpan: () => ({
                    setAttribute: (name: string, value: string | number | boolean) => {
                        attributes[name] = value;
                    },
                    setStatus: (status: SpanStatus) => {
                        statuses.push(status);
                    },
                    end: () => {
                        endCount += 1;
                    },
                }),
            }),
        },
        propagation: {
            inject: (_context: unknown, carrier: Record<string, string>) => {
                carrier.traceparent = '00-test';
            },
        },
        context: { active: () => ({}) },
        SpanStatusCode: { ERROR: 2, OK: 1 },
    };

    try {
        const api = Neutrx.create({
            instrumentation: { openTelemetry: true, propagateTraceHeaders: true },
            adapter: config => ({
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ trace: config.headers.traceparent })),
                config,
            }),
        });

        const response = await api.get('https://api.example.com/test?access_token=secret');
        assert.deepEqual(response.data, { trace: '00-test' });
        assert.equal(attributes['http.request.method'], 'GET');
        assert.equal(attributes['http.target'], '/test');
        assert.equal(attributes['url.path'], '/test');
        assert.equal(attributes['server.address'], 'api.example.com');
        assert.equal(attributes['network.protocol.version'], '1.1');
        assert.equal(attributes['http.response.status_code'], 200);
        assert.equal(attributes['neutrx.retry.count'], 0);
        assert.equal(attributes['neutrx.cache.hit'], false);
        assert.equal(attributes['neutrx.cache.result'], 'miss');
        assert.equal(attributes['neutrx.circuit_breaker.state'], 'CLOSED');
        assert.equal(typeof attributes['neutrx.request.duration_ms'], 'number');
        assert.equal(attributes['url.full'], undefined);
        assert.equal(attributes['url.query'], undefined);
        assert.deepEqual(statuses.at(-1), { code: 1 });
        assert.equal(endCount, 1);
    } finally {
        delete (globalThis as OTelGlobal).__NEUTRX_OTEL_API__;
    }
});

void test('OpenTelemetry instrumentation records safe sizes and service endpoint metadata', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const attributes: Record<string, string | number | boolean> = {};

    (globalThis as OTelGlobal).__NEUTRX_OTEL_API__ = {
        trace: {
            getTracer: () => ({
                startSpan: () => ({
                    setAttribute: (name: string, value: string | number | boolean) => {
                        attributes[name] = value;
                    },
                    end: () => undefined,
                }),
            }),
        },
        propagation: { inject: () => undefined },
        context: { active: () => ({}) },
        SpanStatusCode: { ERROR: 2, OK: 1 },
    };

    try {
        const api = Neutrx.create({
            instrumentation: {
                openTelemetry: true,
                propagateTraceHeaders: false,
                recordRequestBodySize: true,
                recordResponseBodySize: true,
            },
            serviceDiscovery: {
                resolver: [{ url: 'https://api-a.example.com', weight: 3, metadata: { zone: 'a', nested: { ignored: true } } }],
            },
            adapter: config => ({
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json', 'content-length': '11' },
                data: Buffer.from('"ok"'),
                config,
            }),
        });

        await api.post('/write?token=secret', 'hello');

        assert.equal(attributes['http.request.body.size'], 5);
        assert.equal(attributes['http.response.body.size'], 11);
        assert.equal(attributes['neutrx.service.endpoint'], 'https://api-a.example.com');
        assert.equal(attributes['neutrx.service.endpoint.weight'], 3);
        assert.equal(attributes['neutrx.service.endpoint.metadata.zone'], 'a');
        assert.equal(attributes['neutrx.service.endpoint.metadata.nested'], undefined);
        assert.equal(attributes['url.path'], '/write');
        assert.equal(attributes['url.query'], undefined);
    } finally {
        delete (globalThis as OTelGlobal).__NEUTRX_OTEL_API__;
    }
});

void test('OpenTelemetry instrumentation records typed error attributes', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const attributes: Record<string, string | number | boolean> = {};
    let recordedMessage = '';
    let adapterCalls = 0;
    let endCount = 0;
    const statuses: Array<{ readonly code: number; readonly message?: string }> = [];

    (globalThis as OTelGlobal).__NEUTRX_OTEL_API__ = {
        trace: {
            getTracer: () => ({
                startSpan: () => ({
                    setAttribute: (name: string, value: string | number | boolean) => {
                        attributes[name] = value;
                    },
                    recordException: (error: Error) => {
                        recordedMessage = error.message;
                    },
                    setStatus: (status: SpanStatus) => {
                        statuses.push(status);
                    },
                    end: () => {
                        endCount += 1;
                    },
                }),
            }),
        },
        propagation: { inject: () => undefined },
        context: { active: () => ({}) },
        SpanStatusCode: { ERROR: 2, OK: 1 },
    };

    try {
        const api = Neutrx.create({
            instrumentation: { openTelemetry: true, propagateTraceHeaders: false },
            resilience: {
                failureThreshold: 1,
                retryDelay: 0,
                retryJitter: false,
                maxRetries: 2,
            },
            adapter: () => {
                adapterCalls += 1;
                throw Object.assign(new Error('network down'), { name: 'NetworkDownError', code: 'ECONNRESET' });
            },
        });

        await assert.rejects(api.get('https://api.example.com/fail'));

        assert.equal(adapterCalls, 3);
        assert.equal(recordedMessage, 'network down');
        assert.equal(attributes['error.type'], 'NetworkDownError');
        assert.equal(attributes['neutrx.error.code'], 'ECONNRESET');
        assert.equal(attributes['neutrx.retry.count'], 2);
        assert.equal(attributes['neutrx.circuit_breaker.state'], 'OPEN');
        assert.equal(typeof attributes['neutrx.request.duration_ms'], 'number');
        assert.deepEqual(statuses.at(-1), { code: 2, message: 'network down' });
        assert.equal(endCount, 1);
    } finally {
        delete (globalThis as OTelGlobal).__NEUTRX_OTEL_API__;
    }
});

void test('OpenTelemetry instrumentation is a no-op when the OTel API is not installed', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    delete (globalThis as OTelGlobal).__NEUTRX_OTEL_API__;

    const api = Neutrx.create({
        instrumentation: { openTelemetry: true },
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from('{"ok":true}'),
            config,
        }),
    });

    assert.deepEqual((await api.get('https://api.example.com/no-otel')).data, { ok: true });
});

void test('OpenTelemetry instrumentation ends mock response spans exactly once', async () => {
    const { default: Neutrx, MockPlugin } = await import(builtEntry) as typeof PackageEntry;
    let endCount = 0;

    (globalThis as OTelGlobal).__NEUTRX_OTEL_API__ = {
        trace: {
            getTracer: () => ({
                startSpan: () => ({
                    setAttribute: () => undefined,
                    setStatus: () => undefined,
                    end: () => {
                        endCount += 1;
                    },
                }),
            }),
        },
        propagation: { inject: () => undefined },
        context: { active: () => ({}) },
        SpanStatusCode: { ERROR: 2, OK: 1 },
    };

    try {
        const api = Neutrx.create({
            baseURL: 'https://api.example.com',
            instrumentation: { openTelemetry: true, propagateTraceHeaders: false },
        });
        api.use(MockPlugin);
        api.mock?.enable().register('/mocked', { data: { mocked: true } });

        assert.deepEqual((await api.get('/mocked')).data, { mocked: true });
        assert.equal(endCount, 1);
    } finally {
        delete (globalThis as OTelGlobal).__NEUTRX_OTEL_API__;
    }
});
