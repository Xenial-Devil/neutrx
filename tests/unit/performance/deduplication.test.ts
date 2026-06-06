import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';

void test('deduplicateRequests coalesces three simultaneous GET calls and records hits', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let calls = 0;
    const server = http.createServer((request, response) => {
        calls += 1;
        setTimeout(() => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ calls, url: request.url }));
        }, 30);
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            performance: { enableCaching: false, deduplicateRequests: true },
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });
        const dedupEvents: unknown[] = [];
        api.on('request:deduplicated', event => dedupEvents.push(event));

        const [first, second, third] = await Promise.all([
            api.get<{ readonly calls: number; readonly url: string }>('/dedupe', { params: { q: 'same' } }),
            api.get<{ readonly calls: number; readonly url: string }>('/dedupe', { params: { q: 'same' } }),
            api.get<{ readonly calls: number; readonly url: string }>('/dedupe', { params: { q: 'same' } }),
        ]);

        assert.equal(calls, 1);
        assert.deepEqual(first.data, { calls: 1, url: '/dedupe?q=same' });
        assert.deepEqual(second.data, first.data);
        assert.deepEqual(third.data, first.data);
        assert.equal(first.deduplicated, undefined);
        assert.equal(second.deduplicated, true);
        assert.equal(third.deduplicated, true);
        assert.equal(dedupEvents.length, 2);
        assert.equal(api.getMetrics().requests.deduplicated, 2);
        assert.match(api.getMetricsPrometheus(), /neutrx_deduplication_hits_total 2/u);
    } finally {
        await close(server);
    }
});

void test('deduplicateRequests propagates errors to all concurrent callers', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let calls = 0;
    const server = http.createServer((_request, response) => {
        calls += 1;
        setTimeout(() => {
            response.statusCode = 503;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ok: false }));
        }, 30);
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            performance: { enableCaching: false, deduplicateRequests: true },
            resilience: { enableRetry: false },
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        const results = await Promise.allSettled([
            api.get('/fails'),
            api.get('/fails'),
        ]);

        assert.equal(calls, 1);
        assert.equal(rejectedError(results[0]).name, 'NeutrxServerError');
        assert.equal(rejectedError(results[1]).name, 'NeutrxServerError');
        assert.equal(api.getMetrics().requests.deduplicated, 1);
        assert.equal(api.getMetrics().requests.errors, 2);
    } finally {
        await close(server);
    }
});

void test('deduplicateRequests skips POST by default and supports explicit custom-key opt-in', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let defaultPostCalls = 0;
    let optInPostCalls = 0;
    const server = http.createServer((request, response) => {
        request.resume();
        if (request.url === '/post-default') defaultPostCalls += 1;
        if (request.url === '/post-opt-in') optInPostCalls += 1;
        setTimeout(() => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ url: request.url }));
        }, 30);
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const baseURL = `http://127.0.0.1:${address.port}`;
        const security = { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false };
        const defaultApi = Neutrx.create({
            baseURL,
            performance: { enableCaching: false, deduplicateRequests: true },
            security,
        });

        await Promise.all([
            defaultApi.post('/post-default', { ok: true }),
            defaultApi.post('/post-default', { ok: true }),
        ]);
        assert.equal(defaultPostCalls, 2);
        assert.equal(defaultApi.getMetrics().requests.deduplicated, 0);

        const customKeys: string[] = [];
        const optInApi = Neutrx.create({
            baseURL,
            performance: {
                enableCaching: false,
                deduplicateRequests: true,
                deduplicateMethods: ['POST'],
                deduplicateRequestKey(config) {
                    const key = `${config.method}:${config.url}:${config.idempotencyKey ?? ''}`;
                    customKeys.push(key);
                    return key;
                },
            },
            security,
        });

        const [first, second] = await Promise.all([
            optInApi.post('/post-opt-in', { ok: true }, { idempotencyKey: 'post-1' }),
            optInApi.post('/post-opt-in', { ok: true }, { idempotencyKey: 'post-1' }),
        ]);

        assert.equal(optInPostCalls, 1);
        assert.deepEqual(second.data, first.data);
        assert.equal(second.deduplicated, true);
        assert.equal(optInApi.getMetrics().requests.deduplicated, 1);
        assert.ok(customKeys.every(key => key.endsWith(':post-1')));
    } finally {
        await close(server);
    }
});

void test('deduplicateRequests keeps cancellation and timeout policies isolated', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let calls = 0;
    const server = http.createServer((_request, response) => {
        calls += 1;
        setTimeout(() => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ok: true }));
        }, 30);
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            performance: { enableCaching: false, deduplicateRequests: true },
            resilience: { enableRetry: false },
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });
        const firstController = new AbortController();
        const secondController = new AbortController();

        await Promise.all([
            api.get('/signals', { signal: firstController.signal }),
            api.get('/signals', { signal: secondController.signal }),
        ]);
        assert.equal(calls, 2);

        const timeoutResults = await Promise.allSettled([
            api.get('/timeouts', { timeout: 5 }),
            api.get('/timeouts', { timeout: 1000 }),
        ]);
        assert.equal(timeoutResults[0]?.status, 'rejected');
        assert.equal(timeoutResults[1]?.status, 'fulfilled');
        assert.equal(calls, 4);
        assert.equal(api.getMetrics().requests.deduplicated, 0);
    } finally {
        await close(server);
    }
});

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
    return address !== null && typeof address === 'object';
}

function listen(server: http.Server): Promise<void> {
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });
}

function close(server: http.Server): Promise<void> {
    return new Promise(resolve => {
        server.close(() => resolve());
    });
}

function rejectedError(result: PromiseSettledResult<unknown> | undefined): Error {
    assert.equal(result?.status, 'rejected');
    assert.ok(result.reason instanceof Error);
    return result.reason;
}
