import assert from 'node:assert/strict';
import http2 from 'node:http2';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/esm/index.js';

void test('HTTP/2 adapter handles GET, POST body, headers, and status', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const server = http2.createServer();

    server.on('stream', (stream, headers) => {
        const chunks: Buffer[] = [];
        stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
        stream.on('end', () => {
            stream.respond({ ':status': 201, 'content-type': 'application/json' });
            stream.end(JSON.stringify({
                method: headers[':method'],
                path: headers[':path'],
                body: Buffer.concat(chunks).toString('utf8'),
            }));
        });
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            httpVersion: 2,
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        const response = await api.post('/h2', { ok: true });
        assert.equal(response.status, 201);
        assert.deepEqual(response.data, { method: 'POST', path: '/h2', body: '{"ok":true}' });
        api.destroy();
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
