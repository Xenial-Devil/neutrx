import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';

void test('custom adapters run behind request interceptors, retries, and response interceptors', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let calls = 0;
    const seenHeaders: unknown[] = [];
    const api = Neutrx.create({
        adapter: config => {
            calls += 1;
            seenHeaders.push(config.headers['X-Adapter-Test']);
            return {
                status: calls === 1 ? 503 : 200,
                statusText: calls === 1 ? 'Service Unavailable' : 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ calls, header: config.headers['X-Adapter-Test'] })),
                config,
            };
        },
        performance: { enableCaching: false },
        resilience: {
            enableBulkhead: false,
            enableCircuitBreaker: false,
            enableRetry: true,
            maxRetries: 1,
            retryDelay: 0,
            retryJitter: false,
        },
    });

    api.interceptors.request.use(config => ({
        ...config,
        headers: { ...config.headers, 'X-Adapter-Test': 'request-interceptor' },
    }));
    api.interceptors.response.use(response => {
        response.data = { ...(response.data as Record<string, unknown>), responseInterceptor: true };
        return response;
    });

    const response = await api.get('https://adapter.example.test/resource');

    assert.equal(calls, 2);
    assert.deepEqual(seenHeaders, ['request-interceptor', 'request-interceptor']);
    assert.deepEqual(response.data, {
        calls: 2,
        header: 'request-interceptor',
        responseInterceptor: true,
    });
    assert.equal(response.attempts?.length, 2);
});

void test('adapter selection can be swapped per request without changing call shape', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const instanceAdapter = (config: PackageEntry.NeutrxRequestConfig): PackageEntry.RawHttpResponse => ({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: Buffer.from(JSON.stringify({ adapter: 'instance', url: config.url })),
        config,
    });
    const requestAdapter = (config: PackageEntry.NeutrxRequestConfig): PackageEntry.RawHttpResponse => ({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: Buffer.from(JSON.stringify({ adapter: 'request', url: config.url })),
        config,
    });
    const api = Neutrx.create({
        baseURL: 'https://adapter.example.test',
        adapter: instanceAdapter,
        performance: { enableCaching: false },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    });

    const first = await api.get('/same-call');
    const second = await api.get('/same-call', { adapter: requestAdapter });

    assert.deepEqual(first.data, { adapter: 'instance', url: 'https://adapter.example.test/same-call' });
    assert.deepEqual(second.data, { adapter: 'request', url: 'https://adapter.example.test/same-call' });
});

void test('named fetch adapter also participates in interceptors and retries', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let calls = 0;
    const seenHeaders: string[] = [];
    const api = Neutrx.create({
        adapter: 'fetch',
        fetch: (_url, init) => {
            calls += 1;
            seenHeaders.push(new Headers(init?.headers).get('X-Adapter-Test') ?? '');
            return Promise.resolve(new Response(JSON.stringify({ calls }), {
                status: calls === 1 ? 503 : 200,
                headers: { 'content-type': 'application/json' },
            }));
        },
        performance: { enableCaching: false },
        resilience: {
            enableBulkhead: false,
            enableCircuitBreaker: false,
            enableRetry: true,
            maxRetries: 1,
            retryDelay: 0,
            retryJitter: false,
        },
    });

    api.interceptors.request.use(config => ({
        ...config,
        headers: { ...config.headers, 'X-Adapter-Test': 'fetch-request-interceptor' },
    }));

    const response = await api.get('https://fetch.example.test/resource');

    assert.equal(calls, 2);
    assert.deepEqual(seenHeaders, ['fetch-request-interceptor', 'fetch-request-interceptor']);
    assert.deepEqual(response.data, { calls: 2 });
    assert.equal(response.attempts?.length, 2);
});
