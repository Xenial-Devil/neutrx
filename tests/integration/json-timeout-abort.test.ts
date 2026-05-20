import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type * as PackageEntry from '../../src/index.js';

const builtEntry = '../../../dist/esm/index.js';

void test('local server JSON, timeout, and AbortSignal behavior', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const server = http.createServer((request, response) => {
        if (request.url === '/slow') return;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ method: request.method, ok: true }));
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            security: { profile: 'legacy', blockMetadataIPs: true },
            resilience: { enableRetry: false },
        });

        const response = await api.post('/json', { ok: true });
        assert.deepEqual(response.data, { method: 'POST', ok: true });

        await assert.rejects(api.get('/slow', { timeout: 20 }), /timeout/i);

        const controller = new AbortController();
        controller.abort();
        await assert.rejects(api.get('/json', { signal: controller.signal }), /aborted/i);
    } finally {
        await close(server);
    }
});

void test('local server abort during request tears down the client request', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let markReceived!: () => void;
    const received = new Promise<void>(resolve => {
        markReceived = resolve;
    });
    const server = http.createServer((request, response) => {
        if (request.url === '/hold') {
            markReceived();
            request.on('aborted', () => response.destroy());
            return;
        }
        response.end('ok');
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            security: { profile: 'legacy', blockMetadataIPs: true },
            resilience: { enableRetry: false },
        });
        const controller = new AbortController();
        const pending = api.get('/hold', { signal: controller.signal, timeout: 5000 });
        await received;
        controller.abort();

        await assert.rejects(pending, /aborted/u);
    } finally {
        await close(server);
    }
});

void test('local server CancelToken abort preserves cancel reason', async () => {
    const { CancelToken, default: Neutrx, isCancel } = await import(builtEntry) as typeof PackageEntry;
    let markReceived!: () => void;
    const received = new Promise<void>(resolve => {
        markReceived = resolve;
    });
    const server = http.createServer((request, response) => {
        if (request.url === '/hold') {
            markReceived();
            request.on('aborted', () => response.destroy());
            return;
        }
        response.end('ok');
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            security: { profile: 'legacy', blockMetadataIPs: true },
            resilience: { enableRetry: false },
        });
        const source = CancelToken.source();
        const pending = api.get('/hold', { cancelToken: source.token, timeout: 5000 });
        await received;
        source.cancel('legacy cancel');

        await assert.rejects(pending, error => isCancel(error) && error.message === 'legacy cancel');
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
