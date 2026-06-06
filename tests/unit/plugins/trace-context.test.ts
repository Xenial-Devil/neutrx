import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN_ID = '00f067aa0ba902b7';
const PARENT_SPAN_ID = '09f067aa0ba902b0';
const USER_TRACEPARENT = '00-11111111111111111111111111111111-2222222222222222-00';
const OTEL_TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

type OTelGlobal = typeof globalThis & { __NEUTRX_OTEL_API__?: unknown };
type TraceHeaderSnapshot = {
    readonly traceparent: string | null;
    readonly tracestate: string | null;
    readonly b3TraceId: string | null;
    readonly b3SpanId: string | null;
    readonly b3Sampled: string | null;
    readonly b3: string | null;
};

void test('TraceContextPlugin injects generated W3C traceparent headers', async () => {
    const { default: Neutrx, TraceContextPlugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({ adapter: snapshotAdapter });
    api.use(TraceContextPlugin);

    const response = await api.get('https://api.example.com/trace');
    const data = response.data as TraceHeaderSnapshot;

    assert.match(data.traceparent ?? '', /^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/u);
    assert.equal(data.tracestate, null);
    assert.equal(data.b3TraceId, null);
    assert.equal(data.b3, null);
    assert.equal(response.traceContext?.traceId, data.traceparent?.split('-')[1]);
    assert.equal(response.traceContext?.spanId, data.traceparent?.split('-')[2]);
});

void test('TraceContextPlugin supports W3C, B3 multi-header, and B3 single-header formats', async () => {
    const { default: Neutrx, createTraceContextPlugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({ adapter: snapshotAdapter });
    api.use(createTraceContextPlugin({
        formats: ['w3c', 'b3-multi', 'b3-single'],
        context: {
            traceId: TRACE_ID,
            spanId: SPAN_ID,
            parentSpanId: PARENT_SPAN_ID,
            sampled: true,
            tracestate: 'rojo=00f067aa0ba902b7',
        },
    }));

    const response = await api.get('https://api.example.com/trace');
    const data = response.data as TraceHeaderSnapshot;

    assert.equal(data.traceparent, OTEL_TRACEPARENT);
    assert.equal(data.tracestate, 'rojo=00f067aa0ba902b7');
    assert.equal(data.b3TraceId, TRACE_ID);
    assert.equal(data.b3SpanId, SPAN_ID);
    assert.equal(data.b3Sampled, '1');
    assert.equal(data.b3, `${TRACE_ID}-${SPAN_ID}-1-${PARENT_SPAN_ID}`);
    assert.deepEqual(response.traceContext, {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        parentSpanId: PARENT_SPAN_ID,
        sampled: true,
        tracestate: 'rojo=00f067aa0ba902b7',
    });
});

void test('TraceContextPlugin respects user-supplied trace headers unless overwrite is enabled', async () => {
    const { default: Neutrx, createTraceContextPlugin } = await import(builtEntry) as typeof PackageEntry;
    const userHeaders = {
        traceparent: USER_TRACEPARENT,
        tracestate: 'user=state',
        'X-B3-TraceId': '33333333333333333333333333333333',
        'X-B3-SpanId': '4444444444444444',
        'X-B3-Sampled': '0',
        b3: '55555555555555555555555555555555-6666666666666666-0',
    };
    const context = { traceId: TRACE_ID, spanId: SPAN_ID, sampled: true };

    const preserving = Neutrx.create({ adapter: snapshotAdapter });
    preserving.use(createTraceContextPlugin({ formats: ['w3c', 'b3-multi', 'b3-single'], context }));
    const preserved = (await preserving.get('https://api.example.com/trace', { headers: userHeaders })).data as TraceHeaderSnapshot;

    assert.equal(preserved.traceparent, USER_TRACEPARENT);
    assert.equal(preserved.tracestate, 'user=state');
    assert.equal(preserved.b3TraceId, '33333333333333333333333333333333');
    assert.equal(preserved.b3SpanId, '4444444444444444');
    assert.equal(preserved.b3Sampled, '0');
    assert.equal(preserved.b3, '55555555555555555555555555555555-6666666666666666-0');

    const overwriting = Neutrx.create({ adapter: snapshotAdapter });
    overwriting.use(createTraceContextPlugin({ formats: ['w3c', 'b3-multi', 'b3-single'], context, overwrite: true }));
    const overwritten = (await overwriting.get('https://api.example.com/trace', { headers: userHeaders })).data as TraceHeaderSnapshot;

    assert.equal(overwritten.traceparent, OTEL_TRACEPARENT);
    assert.equal(overwritten.b3TraceId, TRACE_ID);
    assert.equal(overwritten.b3SpanId, SPAN_ID);
    assert.equal(overwritten.b3Sampled, '1');
    assert.equal(overwritten.b3, `${TRACE_ID}-${SPAN_ID}-1`);
});

void test('TraceContextPlugin reuses OpenTelemetry carrier trace context for B3 headers', async () => {
    const { default: Neutrx, createTraceContextPlugin } = await import(builtEntry) as typeof PackageEntry;

    (globalThis as OTelGlobal).__NEUTRX_OTEL_API__ = otelApi();
    try {
        const api = Neutrx.create({
            instrumentation: { openTelemetry: true, propagateTraceHeaders: true },
            adapter: snapshotAdapter,
        });
        api.use(createTraceContextPlugin({ formats: ['w3c', 'b3-multi', 'b3-single'] }));

        const response = await api.get('https://api.example.com/trace');
        const data = response.data as TraceHeaderSnapshot;

        assert.equal(data.traceparent, OTEL_TRACEPARENT);
        assert.equal(data.tracestate, 'vendor=value');
        assert.equal(data.b3TraceId, TRACE_ID);
        assert.equal(data.b3SpanId, SPAN_ID);
        assert.equal(data.b3Sampled, '1');
        assert.equal(data.b3, `${TRACE_ID}-${SPAN_ID}-1`);
    } finally {
        delete (globalThis as OTelGlobal).__NEUTRX_OTEL_API__;
    }
});

function snapshotAdapter(config: PackageEntry.NeutrxRequestConfig): PackageEntry.RawHttpResponse {
    return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: Buffer.from(JSON.stringify(snapshotHeaders(config))),
        config,
    };
}

function snapshotHeaders(config: PackageEntry.NeutrxRequestConfig): TraceHeaderSnapshot {
    return {
        traceparent: header(config, 'traceparent'),
        tracestate: header(config, 'tracestate'),
        b3TraceId: header(config, 'X-B3-TraceId'),
        b3SpanId: header(config, 'X-B3-SpanId'),
        b3Sampled: header(config, 'X-B3-Sampled'),
        b3: header(config, 'b3'),
    };
}

function header(config: PackageEntry.NeutrxRequestConfig, name: string): string | null {
    const value = config.headers.get(name);
    if (value === undefined || value === false) return null;
    return Array.isArray(value) ? value.join(', ') : String(value);
}

function otelApi(): NonNullable<OTelGlobal['__NEUTRX_OTEL_API__']> {
    return {
        trace: {
            getTracer: () => ({
                startSpan: () => ({
                    setAttribute: () => undefined,
                    setStatus: () => undefined,
                    end: () => undefined,
                }),
            }),
        },
        propagation: {
            inject: (_context: unknown, carrier: Record<string, string>) => {
                carrier.traceparent = OTEL_TRACEPARENT;
                carrier.tracestate = 'vendor=value';
            },
        },
        context: { active: () => ({}) },
        SpanStatusCode: { ERROR: 2, OK: 1 },
    };
}
