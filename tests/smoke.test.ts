import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import test from 'node:test';
import type * as PackageEntry from '../src/index.js';

const builtEntry = '../../dist/index.js';

void test('package exports load from built output', async () => {
    const mod = await import(builtEntry) as typeof PackageEntry;
    assert.equal(typeof mod.default, 'function');
    assert.equal(typeof mod.default.create, 'function');
    assert.equal(typeof mod.default.get, 'function');
    assert.equal(mod.VERSION, '1.0.0');
});

void test('mock plugin returns typed response through axios-style callable client', async () => {
    const { default: Neutrx, MockPlugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({ baseURL: 'https://api.example.com' });
    assert.equal(typeof api, 'function');

    api.use(MockPlugin);
    api.mock?.enable().register('/health', { status: 200, data: { ok: true } });

    const response = await api('/health');
    const configuredResponse = await api({ url: '/health', method: 'GET' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.data, { ok: true });
    assert.equal(configuredResponse.status, 200);
});

void test('stream upload reports progress with percent when content length is known', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const payload = Buffer.alloc(64 * 1024, 'a');
    const chunks = [
        payload.subarray(0, 16 * 1024),
        payload.subarray(16 * 1024, 32 * 1024),
        payload.subarray(32 * 1024, 48 * 1024),
        payload.subarray(48 * 1024),
    ];
    const progress: number[] = [];

    const server = http.createServer((request, response) => {
        let received = 0;
        request.on('data', (chunk: Buffer) => {
            received += chunk.length;
        });
        request.on('end', () => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ received }));
        });
    });

    await new Promise<void>(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const port = address.port;

        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${port}`,
            security: {
                enforceHTTPS: false,
                enableSSRFProtection: false,
                blockPrivateIPs: false,
            },
        });

        const upload = Readable.from(chunks);
        const response = await api.upload<{ readonly received: number }, Readable>('/upload', upload, {
            headers: { 'Content-Length': payload.length },
            onUploadProgress(event) {
                if (event.percent !== undefined) progress.push(event.percent);
            },
        });

        assert.equal(response.data.received, payload.length);
        assert.deepEqual(progress, [0, 25, 50, 75, 100]);
    } finally {
        await new Promise<void>(resolve => {
            server.close(() => resolve());
        });
    }
});

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
    return address !== null && typeof address === 'object';
}
