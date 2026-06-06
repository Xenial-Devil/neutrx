import assert from 'node:assert/strict';
import http from 'node:http';
import net, { type AddressInfo, type Socket } from 'node:net';
import test from 'node:test';
import zlib from 'node:zlib';
import type * as PackageEntry from '../../src/index.js';

const builtEntry = '../../../dist/index.mjs';

void test('socketPath and allowAbsoluteUrls prepare local infrastructure URLs before dispatch', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\neutrx-docker' : '/var/run/docker.sock';
    const api = Neutrx.create({
        baseURL: 'http://docker',
        allowAbsoluteUrls: false,
        socketPath,
        proxy: false,
        security: { profile: 'strict' },
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({
                url: config.url,
                socketPath: config.socketPath,
                proxy: config.proxy,
                allowAbsoluteUrls: config.allowAbsoluteUrls,
            })),
            config,
        }),
    });

    const response = await api.get('http://containers/json');
    assert.deepEqual(response.data, {
        url: 'http://docker/http://containers/json',
        socketPath,
        proxy: false,
        allowAbsoluteUrls: false,
    });

    await assert.rejects(api.get('https://docker/v1/version', { allowAbsoluteUrls: true }), /socketPath supports HTTP URLs only/u);
    await assert.rejects(api.get('/bad', { socketPath: 'relative.sock' }), /socketPath must be an absolute local path/u);
});

void test('node http adapter sends HTTP requests through an explicit local proxy', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const proxy = http.createServer((request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
            method: request.method,
            url: request.url,
            host: headerValue(request.headers.host),
            proxyAuthorization: headerValue(request.headers['proxy-authorization']),
            proxyTrace: headerValue(request.headers['x-proxy-trace']),
        }));
    });

    await listen(proxy);

    try {
        const address = proxy.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            adapter: 'http',
            baseURL: 'http://127.0.0.1:65530',
            proxy: {
                host: '127.0.0.1',
                port: address.port,
                auth: { username: 'proxy-user', password: 'proxy-pass' },
                headers: { 'X-Proxy-Trace': 'infra-test' },
            },
            resilience: { enableRetry: false },
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        const response = await api.get<{
            readonly method: string;
            readonly url: string;
            readonly host: string;
            readonly proxyAuthorization: string;
            readonly proxyTrace: string;
        }>('/service', { params: { check: 1 } });

        assert.equal(response.data.method, 'GET');
        assert.equal(response.data.url, 'http://127.0.0.1:65530/service?check=1');
        assert.equal(response.data.host, '127.0.0.1:65530');
        assert.equal(response.data.proxyAuthorization, `Basic ${Buffer.from('proxy-user:proxy-pass').toString('base64')}`);
        assert.equal(response.data.proxyTrace, 'infra-test');
    } finally {
        await close(proxy);
    }
});

void test('decompress and responseEncoding support legacy infrastructure payloads', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const latin1Payload = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    const jsonPayload = Buffer.from(JSON.stringify({ ok: true }));
    const zipped = zlib.gzipSync(jsonPayload);
    const server = http.createServer((request, response) => {
        if (request.url === '/latin1') {
            response.setHeader('content-type', 'text/plain');
            response.end(latin1Payload);
            return;
        }

        response.setHeader('content-type', 'application/json');
        response.setHeader('content-encoding', 'gzip');
        response.end(zipped);
    });

    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            responseEncoding: 'latin1',
            performance: { enableCaching: false },
            resilience: { enableRetry: false },
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        const text = await api.get<string>('/latin1', { responseType: 'text' });
        assert.equal(text.data, 'café');

        const decoded = await api.get('/gzip');
        assert.deepEqual(decoded.data, { ok: true });

        const compressed = await api.get<Buffer>('/gzip', { responseType: 'buffer', decompress: false });
        assert.equal(Buffer.compare(compressed.data, zipped), 0);
    } finally {
        await close(server);
    }
});

void test('clarified timeout errors expose code, phase, and timeout in JSON', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const server = http.createServer((_request, response) => {
        setTimeout(() => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ok: true }));
        }, 100);
    });

    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            timeout: 20,
            resilience: { enableRetry: false },
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        await assert.rejects(
            api.get('/slow', { transitional: { clarifyTimeoutError: true } }),
            error => {
                const typed = error as Error & { readonly code?: string; readonly toJSON?: () => Record<string, unknown> };
                const json = typed.toJSON?.() ?? {};
                assert.equal(Neutrx.isNeutrxError(error), true);
                assert.equal(typed.code, 'ETIMEDOUT');
                assert.equal(json.code, 'ETIMEDOUT');
                assert.equal(json.phase, 'response');
                assert.equal(json.timeout, 20);
                assert.match(String(json.message), /Response timeout after 20ms/u);
                return true;
            }
        );
    } finally {
        await close(server);
    }
});

void test('connect timeout remains active through a stalled TLS handshake', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const sockets = new Set<Socket>();
    const server = net.createServer(socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
    });

    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            adapter: 'http',
            baseURL: `https://127.0.0.1:${address.port}`,
            connectTimeout: 50,
            timeout: 1000,
            transitional: { clarifyTimeoutError: true },
            resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
            security: {
                enforceHTTPS: false,
                validateCertificate: false,
                enableSSRFProtection: false,
                blockPrivateIPs: false,
            },
        });

        await assert.rejects(
            api.get('/stalled-handshake'),
            error => {
                const typed = error as Error & { readonly code?: string; readonly toJSON?: () => Record<string, unknown> };
                const json = typed.toJSON?.() ?? {};
                assert.equal(typed.code, 'ETIMEDOUT');
                assert.equal(json.phase, 'connect');
                assert.equal(json.timeout, 50);
                assert.match(String(json.message), /Connect timeout after 50ms/u);
                return true;
            }
        );
    } finally {
        for (const socket of sockets) socket.destroy();
        await close(server);
    }
});

void test('utility methods configure and inspect an operational client', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({
                url: config.url,
                timeout: config.timeout,
                serviceHeader: config.headers.get('X-Service'),
                authorization: config.headers.get('Authorization'),
            })),
            config,
        }),
    });

    api
        .setBaseURL('https://infra.example/api')
        .setTimeout(2500)
        .setHeader('X-Service', 'inventory')
        .setAuth({ bearer: 'secret-token' });

    assert.equal(api.getUri({ url: '/health', params: { shard: 1 } }), 'https://infra.example/api/health?shard=1');

    const response = await api.get<{
        readonly url: string;
        readonly timeout: number;
        readonly serviceHeader: string;
        readonly authorization: false;
    }>('/health', {
        headers: { Authorization: false },
    });

    assert.deepEqual(response.data, {
        url: 'https://infra.example/api/health',
        timeout: 2500,
        serviceHeader: 'inventory',
        authorization: false,
    });
    assert.match(api.getMetricsPrometheus(), /neutrx_requests_total/u);
    assert.equal(api.getCacheStats().hitRate, '0.0%');
    assert.ok(api.getCircuitStatus());
    assert.ok(api.getBulkheadStats());
    assert.equal(api.getEgressPolicy().mode, 'custom');

    api.removeHeader('X-Service').clearAuth().clearCache().invalidateCache('/health').deleteCacheEntry('/health').resetMetrics();
    assert.equal(api.getMetrics().requests.total, 0);
    api.destroy();
});

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
    return address !== null && typeof address === 'object';
}

function listen(server: http.Server | net.Server): Promise<void> {
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });
}

function close(server: http.Server | net.Server): Promise<void> {
    return new Promise(resolve => {
        server.close(() => resolve());
    });
}

function headerValue(value: string | readonly string[] | undefined): string {
    if (typeof value === 'string') return value;
    if (value) return value.join(', ');
    return '';
}
