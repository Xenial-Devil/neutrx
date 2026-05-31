import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../src/index.js';

const builtEntry = '../../../dist/index.mjs';

void test('ergonomic API surface supports verbs, create, defaults, transforms, adapters, and errors', async () => {
    const { default: Neutrx, isNeutrxError } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        baseURL: 'https://api.example.com',
        paramsSerializer: params => `page=${paramToString(params.page)}`,
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({
                method: config.method,
                url: config.url,
                body: config.data,
                transformed: config.headers['X-Transform'],
            })),
            config,
        }),
    });

    const response = await api.post('/users', { name: 'Ada' }, {
        params: { page: 2 },
        transformRequest(data, headers) {
            headers['X-Transform'] = 'yes';
            return JSON.stringify(data);
        },
        transformResponse(data) {
            return data && typeof data === 'object' && !Buffer.isBuffer(data) && !('pipe' in data)
                ? { ...data, responseTransformed: true }
                : data;
        },
    });

    assert.equal(api.getUri({ url: '/users', params: { page: 2 } }), 'https://api.example.com/users?page=2');
    assert.deepEqual(response.data, {
        method: 'POST',
        url: 'https://api.example.com/users?page=2',
        body: '{"name":"Ada"}',
        transformed: 'yes',
        responseTransformed: true,
    });

    await assert.rejects(
        api.request({ url: 'https://api.example.com', method: 'TRACE' as never }),
        error => error instanceof Error && isNeutrxError(error)
    );

    await assert.rejects(
        api.request({ url: 'https://api.example.com', method: 'TRACE' as never }),
        error => error instanceof Error && isNeutrxError(error)
    );
});

void test('client default precedence follows library, instance, then request config', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        baseURL: 'https://api.example.com',
        timeout: 1000,
        headers: { 'X-Level': 'instance' },
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({
                timeout: config.timeout,
                header: config.headers['X-Level'],
                url: config.url,
            })),
            config,
        }),
    });

    const response = await api.get('/users', {
        timeout: 2000,
        headers: { 'X-Level': 'request' },
    });

    assert.deepEqual(response.data, {
        timeout: 2000,
        header: 'request',
        url: 'https://api.example.com/users',
    });
});

void test('mutable instance defaults apply after client creation and request config still wins', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        baseURL: 'https://initial.example',
        timeout: 1000,
        headers: { 'X-Level': 'instance' },
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({
                timeout: config.timeout,
                url: config.url,
                authorization: config.headers.Authorization,
                level: config.headers['X-Level'],
                leakedCommon: config.headers.common,
            })),
            config,
        }),
    });

    api.defaults.baseURL = 'https://tenant.example/v2';
    api.defaults.timeout = 10_000;
    api.defaults.headers.common.Authorization = 'Bearer dynamic-token';
    api.defaults.headers.common['X-Level'] = 'defaults';

    const first = await api.get('/users');
    const second = await api.get('/users', {
        baseURL: 'https://request.example',
        timeout: 250,
        headers: {
            Authorization: 'Bearer request-token',
            'X-Level': 'request',
        },
    });

    assert.deepEqual(first.data, {
        timeout: 10_000,
        url: 'https://tenant.example/v2/users',
        authorization: 'Bearer dynamic-token',
        level: 'defaults',
    });
    assert.deepEqual(second.data, {
        timeout: 250,
        url: 'https://request.example/users',
        authorization: 'Bearer request-token',
        level: 'request',
    });

    api.defaults.security = { enforceHTTPS: false };
    await assert.rejects(
        api.get('/unsafe-default'),
        /Cannot mutate live instance defaults\.security/u
    );
    delete api.defaults.security;
});

void test('service discovery resolves relative requests with round-robin endpoints', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const seen: string[] = [];
    const api = Neutrx.create({
        performance: { enableCaching: false },
        serviceDiscovery: {
            resolver: [
                { url: 'https://one.example.com', metadata: { zone: 'a' } },
                'https://two.example.com',
            ],
            strategy: 'round-robin',
        },
        adapter: config => {
            seen.push(config.url);
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({
                    url: config.url,
                    endpoint: config.serviceEndpoint?.url,
                    zone: config.serviceEndpoint?.metadata?.zone ?? null,
                })),
                config,
            };
        },
    });

    const first = await api.get('/health');
    const second = await api.get('/health');
    const third = await api.get('/health');

    assert.deepEqual(seen, [
        'https://one.example.com/health',
        'https://two.example.com/health',
        'https://one.example.com/health',
    ]);
    assert.deepEqual(first.data, { url: 'https://one.example.com/health', endpoint: 'https://one.example.com', zone: 'a' });
    assert.deepEqual(second.data, { url: 'https://two.example.com/health', endpoint: 'https://two.example.com', zone: null });
    assert.deepEqual(third.data, { url: 'https://one.example.com/health', endpoint: 'https://one.example.com', zone: 'a' });
});

void test('service discovery supports async request resolver and skips absolute URLs', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        performance: { enableCaching: false },
        serviceDiscovery: { resolver: ['https://instance.example.com'] },
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({
                url: config.url,
                endpoint: config.serviceEndpoint?.url ?? null,
            })),
            config,
        }),
    });

    const relative = await api.get('/orders', {
        serviceDiscovery: {
            resolver: context => Promise.resolve([{ url: `https://${context.method.toLowerCase()}.example.com`, weight: 2 }]),
            strategy: 'sticky-origin',
        },
    });
    const absolute = await api.get('https://direct.example.com/status');

    assert.deepEqual(relative.data, { url: 'https://get.example.com/orders', endpoint: 'https://get.example.com' });
    assert.deepEqual(absolute.data, { url: 'https://direct.example.com/status', endpoint: null });
});

void test('Axios migration helpers support auth alias and indexed params', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        baseURL: 'https://api.example.com',
        auth: { username: 'instance', password: 'secret' },
        paramsSerializer: { indexes: false },
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({
                url: config.url,
                authorization: config.headers.Authorization,
                leakedAuthConfig: 'auth' in config,
            })),
            config,
        }),
    });

    const response = await api.get('/search', {
        params: {
            tag: ['security', 'node'],
            filter: { q: 'hello world' },
        },
        auth: { username: 'request', password: 'override' },
    });

    assert.equal(
        response.data && typeof response.data === 'object' && 'url' in response.data ? response.data.url : '',
        'https://api.example.com/search?tag%5B%5D=security&tag%5B%5D=node&filter%5Bq%5D=hello+world'
    );
    assert.equal(
        response.data && typeof response.data === 'object' && 'authorization' in response.data ? response.data.authorization : '',
        `Basic ${Buffer.from('request:override').toString('base64')}`
    );
    assert.equal(response.data && typeof response.data === 'object' && 'leakedAuthConfig' in response.data ? response.data.leakedAuthConfig : true, false);
});

void test('client cache stores GET responses but not unsafe methods', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let calls = 0;
    const api = Neutrx.create({
        baseURL: 'https://api.example.com',
        performance: { enableCaching: true, cacheTTL: 1000 },
        adapter: config => {
            calls += 1;
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ calls, method: config.method })),
                config,
            };
        },
    });

    const firstGet = await api.get('/cacheable');
    const secondGet = await api.get('/cacheable');
    const firstPost = await api.post('/unsafe', { ok: true });
    const secondPost = await api.post('/unsafe', { ok: true });

    assert.equal(firstGet.data && typeof firstGet.data === 'object' && 'calls' in firstGet.data ? firstGet.data.calls : 0, 1);
    assert.equal(secondGet.cached, true);
    assert.equal(firstPost.data && typeof firstPost.data === 'object' && 'calls' in firstPost.data ? firstPost.data.calls : 0, 2);
    assert.equal(secondPost.data && typeof secondPost.data === 'object' && 'calls' in secondPost.data ? secondPost.data.calls : 0, 3);
});

void test('client stale-while-revalidate returns stale data and refreshes in the background', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let calls = 0;
    let releaseRevalidation: (() => void) | undefined;
    const revalidationStarted = deferred<void>();
    const revalidated = deferred<void>();
    const revalidationEvents: Array<{ readonly updated: boolean; readonly skipped?: boolean; readonly status?: number }> = [];
    const api = Neutrx.create({
        baseURL: 'https://api.example.com',
        performance: {
            enableCaching: true,
            cacheStrategy: 'swr',
            cacheTTL: 1000,
            revalidateAfter: 20,
            onRevalidate: event => {
                revalidationEvents.push({
                    updated: event.updated,
                    ...(event.skipped ? { skipped: event.skipped } : {}),
                    ...(event.status !== undefined ? { status: event.status } : {}),
                });
                if (event.updated) revalidated.resolve();
            },
        },
        adapter: async config => {
            calls += 1;
            if (calls === 2) {
                revalidationStarted.resolve();
                await new Promise<void>(resolve => {
                    releaseRevalidation = resolve;
                });
            }
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ calls })),
                config,
            };
        },
    });

    const first = await api.get('/swr');
    await sleep(30);
    const stale = await api.get('/swr');
    await revalidationStarted.promise;
    const duplicate = await api.get('/swr');

    assert.deepEqual(first.data, { calls: 1 });
    assert.equal(stale.cached, true);
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.data, { calls: 1 });
    assert.equal(duplicate.stale, true);
    assert.equal(calls, 2);

    releaseRevalidation?.();
    await revalidated.promise;
    const refreshed = await api.get('/swr');

    assert.equal(refreshed.cached, true);
    assert.equal(refreshed.stale, false);
    assert.deepEqual(refreshed.data, { calls: 2 });
    assert.ok(revalidationEvents.some(event => event.updated && event.status === 200));
    assert.ok(revalidationEvents.some(event => event.skipped));
});

void test('client cache invalidation methods remove cached responses', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let calls = 0;
    const api = Neutrx.create({
        baseURL: 'https://api.example.com',
        performance: { enableCaching: true, cacheTTL: 1000 },
        adapter: config => {
            calls += 1;
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ calls })),
                config,
            };
        },
    });

    await api.get('/cache/users');
    assert.equal((await api.get('/cache/users')).cached, true);
    api.deleteCacheEntry('/cache/users');
    assert.equal((await api.get('/cache/users')).cached, undefined);

    await api.get('/cache/orders');
    assert.equal((await api.get('/cache/orders')).cached, true);
    api.invalidateCache(/cache\/orders/u);
    assert.equal((await api.get('/cache/orders')).cached, undefined);
});

void test('idempotency key header enables retry for unsafe methods', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let calls = 0;
    const api = Neutrx.create({
        baseURL: 'https://api.example.com',
        resilience: {
            maxRetries: 1,
            retryDelay: 0,
            retryJitter: false,
            retryableCodes: ['ETEST'],
        },
        adapter: config => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error('retry idempotent post'), { code: 'ETEST' });
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({
                    key: config.headers['Idempotency-Key'],
                    retained: config.idempotencyKey,
                })),
                config,
            };
        },
    });

    const response = await api.post('/charge', { amount: 42 }, { idempotencyKey: 'charge-1' });

    assert.equal(calls, 2);
    assert.deepEqual(response.data, { key: 'charge-1', retained: 'charge-1' });
});

function paramToString(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function deferred<TValue>(): {
    readonly promise: Promise<TValue>;
    readonly resolve: (value?: TValue | PromiseLike<TValue>) => void;
} {
    let resolve: (value?: TValue | PromiseLike<TValue>) => void = () => undefined;
    const promise = new Promise<TValue>(innerResolve => {
        resolve = innerResolve as (value?: TValue | PromiseLike<TValue>) => void;
    });
    return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
