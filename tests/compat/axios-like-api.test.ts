import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../src/index.js';

const builtEntry = '../../../dist/esm/index.js';

void test('axios-like API surface supports verbs, create, defaults, transforms, adapters, and errors', async () => {
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
});
