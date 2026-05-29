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
    let ended = false;

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
                        ended = true;
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
        assert.equal(attributes['url.path'], '/test');
        assert.equal(attributes['server.address'], 'api.example.com');
        assert.equal(attributes['network.protocol.version'], '1.1');
        assert.equal(attributes['http.response.status_code'], 200);
        assert.equal(attributes['url.full'], undefined);
        assert.equal(attributes['url.query'], undefined);
        assert.deepEqual(statuses.at(-1), { code: 1 });
        assert.equal(ended, true);
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
            instrumentation: { openTelemetry: true, propagateTraceHeaders: false },
            adapter: () => {
                throw Object.assign(new Error('network down'), { name: 'NetworkDownError', code: 'ENETDOWN' });
            },
        });

        await assert.rejects(api.get('https://api.example.com/fail'));

        assert.equal(recordedMessage, 'network down');
        assert.equal(attributes['error.type'], 'NetworkDownError');
        assert.equal(attributes['neutrx.error.code'], 'ENETDOWN');
        assert.deepEqual(statuses.at(-1), { code: 2, message: 'network down' });
    } finally {
        delete (globalThis as OTelGlobal).__NEUTRX_OTEL_API__;
    }
});
