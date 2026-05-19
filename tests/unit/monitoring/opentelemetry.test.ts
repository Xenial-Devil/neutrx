import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/esm/index.js';

type OTelGlobal = typeof globalThis & { __NEUTRX_OTEL_API__?: unknown };

void test('OpenTelemetry instrumentation creates spans and propagates trace headers', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const attributes: Record<string, string | number | boolean> = {};
    let ended = false;

    (globalThis as OTelGlobal).__NEUTRX_OTEL_API__ = {
        trace: {
            getTracer: () => ({
                startSpan: () => ({
                    setAttribute: (name: string, value: string | number | boolean) => {
                        attributes[name] = value;
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
        assert.equal(attributes['http.response.status_code'], 200);
        assert.equal(ended, true);
    } finally {
        delete (globalThis as OTelGlobal).__NEUTRX_OTEL_API__;
    }
});
