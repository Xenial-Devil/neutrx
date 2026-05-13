import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import test from 'node:test';
import type * as PackageEntry from '../src/index.js';
import type { LookupFunction } from '../src/index.js';

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

void test('cross-origin redirects strip sensitive headers and post bodies', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const captured: { method?: string; headers?: http.IncomingHttpHeaders; body?: string } = {};

    const target = http.createServer((request, response) => {
        captured.method = request.method ?? '';
        captured.headers = request.headers;
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            captured.body = Buffer.concat(chunks).toString('utf8');
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ok: true }));
        });
    });
    await listen(target);

    const targetAddress = target.address();
    assert.ok(isAddressInfo(targetAddress));
    const source = http.createServer((_request, response) => {
        response.statusCode = 302;
        response.setHeader('location', `http://127.0.0.1:${targetAddress.port}/final`);
        response.end();
    });
    await listen(source);

    try {
        const sourceAddress = source.address();
        assert.ok(isAddressInfo(sourceAddress));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${sourceAddress.port}`,
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        await api.post('/start', { secret: true }, {
            headers: {
                Authorization: 'Bearer secret',
                Cookie: 'sid=secret',
                'Proxy-Authorization': 'Basic secret',
                'Content-Length': 16,
            },
        });

        assert.equal(captured.method, 'GET');
        assert.equal(captured.headers?.authorization, undefined);
        assert.equal(captured.headers?.cookie, undefined);
        assert.equal(captured.headers?.['proxy-authorization'], undefined);
        assert.equal(captured.headers?.['content-length'], undefined);
        assert.equal(captured.body, '');
    } finally {
        await close(source);
        await close(target);
    }
});

void test('DNS SSRF protection validates custom lookup results', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const lookup = ((hostname: string, options: unknown, callback?: unknown): void => {
        const done = (typeof options === 'function' ? options : callback) as (error: Error | null, address?: string, family?: number) => void;
        assert.equal(hostname, 'public.example.test');
        done(null, '127.0.0.1', 4);
    }) as LookupFunction;

    const api = Neutrx.create({
        security: { enforceHTTPS: false, enableSSRFProtection: true, blockPrivateIPs: true },
        resilience: { enableRetry: false },
    });

    await assert.rejects(
        api.get('http://public.example.test/', { lookup }),
        (error: unknown) => error instanceof Error && error.name === 'NeutrxSSRFError'
    );
});

void test('invalid methods throw instead of silently becoming GET', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({ security: { enforceHTTPS: false, enableSSRFProtection: false } });

    await assert.rejects(
        api.request({ url: 'http://example.com/', method: 'TRACE' as never }),
        (error: unknown) => error instanceof Error && error.name === 'NeutrxSecurityError'
    );
});

void test('axios-style interceptors, serializers, transforms, and download progress work', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const progress: number[] = [];
    const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            const payload = JSON.stringify({
                url: request.url,
                requestHeader: request.headers['x-compat'],
                transformedHeader: request.headers['x-transformed'],
                body: Buffer.concat(chunks).toString('utf8'),
            });
            response.setHeader('content-type', 'application/json');
            response.setHeader('content-length', Buffer.byteLength(payload));
            response.end(payload);
        });
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            paramsSerializer: params => `custom=${params.custom}`,
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        const requestId = api.interceptors.request.use(config => ({
            ...config,
            headers: { ...config.headers, 'X-Compat': 'request' },
        }));
        api.interceptors.response.use(response => {
            if (response.data && typeof response.data === 'object' && !Buffer.isBuffer(response.data) && !('pipe' in response.data)) {
                response.data = { ...response.data, intercepted: true };
            }
            return response;
        });

        const result = await api.post('/echo', { name: 'Ada' }, {
            params: { custom: '1', ignored: '2' },
            transformRequest(data, headers) {
                headers['Content-Type'] = 'application/json';
                headers['X-Transformed'] = 'yes';
                return JSON.stringify(data);
            },
            transformResponse(data) {
                if (data && typeof data === 'object' && !Buffer.isBuffer(data) && !('pipe' in data)) {
                    return { ...data, transformed: true };
                }
                return data;
            },
            onDownloadProgress(event) {
                if (event.percent !== undefined) progress.push(event.percent);
            },
        });

        api.interceptors.request.eject(requestId);

        const data = result.data as Record<string, unknown>;
        assert.equal(data.url, '/echo?custom=1');
        assert.equal(data.requestHeader, 'request');
        assert.equal(data.transformedHeader, 'yes');
        assert.equal(data.body, '{"name":"Ada"}');
        assert.equal(data.transformed, true);
        assert.equal(data.intercepted, true);
        assert.equal(progress.at(-1), 100);
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
