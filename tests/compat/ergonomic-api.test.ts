import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../src/index.js';

const builtEntry = '../../../dist/esm/index.js';

void test('ergonomic API surface supports verbs, create, defaults, transforms, adapters, and errors', async () => {
    const { default: Neutrx, isNeutrxError } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        baseURL: 'https://api.example.com',
        paramsSerializer: params => `page=${String(params.page)}`,
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
