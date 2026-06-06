import assert from 'node:assert/strict';
import http from 'node:http';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';

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
                header: headers['x-test'],
                connection: headers.connection ?? null,
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

        const response = await api.post('/h2', { ok: true }, {
            headers: { 'X-Test': 'h2', Connection: 'close' },
        });
        assert.equal(response.status, 201);
        assert.deepEqual(response.data, { method: 'POST', path: '/h2', header: 'h2', connection: null, body: '{"ok":true}' });
        api.destroy();
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});

void test('HTTP/2 adapter reuses sessions and retires idle sessions after timeout', async () => {
    const { default: Neutrx, getHttp2SessionStats } = await import(builtEntry) as typeof PackageEntry;
    const server = http2.createServer();
    let serverSessions = 0;

    server.on('session', () => {
        serverSessions += 1;
    });
    server.on('stream', stream => {
        stream.respond({ ':status': 200, 'content-type': 'application/json' });
        stream.end(JSON.stringify({ ok: true }));
    });

    await listenHttp2(server);
    const address = server.address();
    assert.ok(isAddressInfo(address));
    const origin = `http://127.0.0.1:${address.port}`;
    const api = Neutrx.create({
        baseURL: origin,
        httpVersion: 2,
        http2Options: { sessionTimeout: 30, maxSessions: 4 },
        security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
    });

    try {
        await api.get('/one');
        await api.get('/two');

        assert.equal(serverSessions, 1);
        assert.equal(getHttp2SessionStats().origins[origin]?.sessionCount, 1);

        await waitFor(() => getHttp2SessionStats().sessions === 0);
    } finally {
        api.destroy();
        await closeHttp2(server);
    }
});

void test('HTTP/2 sessions are isolated per client and client destroy is scoped', async () => {
    const { default: Neutrx, getHttp2SessionStats } = await import(builtEntry) as typeof PackageEntry;
    const server = http2.createServer();
    let serverSessions = 0;

    server.on('session', () => {
        serverSessions += 1;
    });
    server.on('stream', stream => {
        stream.respond({ ':status': 200, 'content-type': 'application/json' });
        stream.end(JSON.stringify({ ok: true }));
    });

    await listenHttp2(server);
    const address = server.address();
    assert.ok(isAddressInfo(address));
    const origin = `http://127.0.0.1:${address.port}`;
    const config = {
        baseURL: origin,
        httpVersion: 2 as const,
        security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
    };
    const first = Neutrx.create(config);
    const second = Neutrx.create(config);

    try {
        await first.get('/first');
        await second.get('/second');
        assert.equal(serverSessions, 2);
        assert.equal(getHttp2SessionStats().origins[origin]?.sessionCount, 2);

        first.destroy();
        assert.equal(getHttp2SessionStats().origins[origin]?.sessionCount, 1);

        await second.get('/still-open');
        assert.equal(serverSessions, 2);
    } finally {
        first.destroy();
        second.destroy();
        await closeHttp2(server);
    }
});

void test('HTTP/2 adapter supports stream download progress', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const payload = Buffer.alloc(32 * 1024, 'd');
    const downloadEvents: PackageEntry.ProgressEvent[] = [];
    const server = http2.createServer();

    server.on('stream', stream => {
        stream.respond({ ':status': 200, 'content-length': payload.length, 'content-type': 'application/octet-stream' });
        stream.end(payload);
    });

    await listenHttp2(server);
    const api = createHttp2Api(Neutrx, server);

    try {
        const response = await api.get<Readable>('/stream', {
            responseType: 'stream',
            onDownloadProgress: event => downloadEvents.push(event),
        });
        const received = await collectReadable(response.data);

        assert.equal(received.equals(payload), true);
        assert.equal(downloadEvents[0]?.loaded, 0);
        assert.equal(downloadEvents.at(-1)?.loaded, payload.length);
        assert.equal(downloadEvents.at(-1)?.progress, 1);
    } finally {
        api.destroy();
        await closeHttp2(server);
    }
});

void test('HTTP/2 adapter supports stream upload progress', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const payload = Buffer.alloc(24 * 1024, 'u');
    const uploadEvents: PackageEntry.ProgressEvent[] = [];
    const server = http2.createServer();

    server.on('stream', stream => {
        const chunks: Buffer[] = [];
        stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
        stream.on('end', () => {
            stream.respond({ ':status': 200, 'content-type': 'application/json' });
            stream.end(JSON.stringify({ received: Buffer.concat(chunks).length }));
        });
    });

    await listenHttp2(server);
    const api = createHttp2Api(Neutrx, server);

    try {
        const response = await api.post<{ readonly received: number }, Readable>('/upload', Readable.from([payload]), {
            headers: { 'Content-Length': payload.length },
            onUploadProgress: event => uploadEvents.push(event),
        });

        assert.deepEqual(response.data, { received: payload.length });
        assert.equal(uploadEvents[0]?.loaded, 0);
        assert.equal(uploadEvents.at(-1)?.loaded, payload.length);
        assert.equal(uploadEvents.at(-1)?.progress, 1);
    } finally {
        api.destroy();
        await closeHttp2(server);
    }
});

void test('HTTP/1.1 adapter selection is unchanged when httpVersion is 1', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const server = http.createServer((_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ protocol: 'http1' }));
    });

    await listenHttp1(server);
    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            httpVersion: 1,
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        const response = await api.get('/http1');
        assert.deepEqual(response.data, { protocol: 'http1' });
        api.destroy();
    } finally {
        await closeHttp1(server);
    }
});

function createHttp2Api(
    Neutrx: typeof PackageEntry.default,
    server: http2.Http2Server
): ReturnType<typeof PackageEntry.default.create> {
    const address = server.address();
    assert.ok(isAddressInfo(address));
    return Neutrx.create({
        baseURL: `http://127.0.0.1:${address.port}`,
        httpVersion: 2,
        timeout: 10_000,
        security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
    });
}

async function collectReadable(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks);
}

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
    return address !== null && typeof address === 'object';
}

function listenHttp2(server: http2.Http2Server): Promise<void> {
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });
}

function closeHttp2(server: http2.Http2Server): Promise<void> {
    return new Promise(resolve => {
        server.close(() => resolve());
    });
}

function listenHttp1(server: http.Server): Promise<void> {
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });
}

function closeHttp1(server: http.Server): Promise<void> {
    return new Promise(resolve => {
        server.close(() => resolve());
    });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise(resolve => {
            setTimeout(resolve, 10);
        });
    }
    assert.equal(predicate(), true);
}

void test('HTTP/2 requests follow redirects with Neutrx redirect policy', async () => {
    const { default: Neutrx, getHttp2SessionStats } = await import(builtEntry) as typeof PackageEntry;
    const server = http2.createServer();

    server.on('stream', (stream, headers) => {
        if (headers[':path'] === '/start') {
            stream.respond({ ':status': 302, location: '/final' });
            stream.end();
            return;
        }
        stream.respond({ ':status': 200, 'content-type': 'application/json' });
        stream.end(JSON.stringify({ path: headers[':path'] }));
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            httpVersion: 2,
            http2Options: { maxConcurrentStreams: 8 },
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        const response = await api.get('/start');
        assert.equal(response.status, 200);
        assert.deepEqual(response.data, { path: '/final' });
        assert.equal(getHttp2SessionStats().sessions > 0, true);
        api.destroy();
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
