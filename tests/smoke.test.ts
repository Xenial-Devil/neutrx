import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import test from 'node:test';
import type * as PackageEntry from '../src/index.js';
import type { LookupFunction } from '../src/index.js';

const builtEntry = '../../dist/esm/index.js';
const browserEntry = '../../dist/esm/browser.js';
const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as { readonly version: string };

void test('package exports load from built output', async () => {
    const mod = await import(builtEntry) as typeof PackageEntry;
    assert.equal(typeof mod.default, 'function');
    assert.equal(typeof mod.default.create, 'function');
    assert.equal(typeof mod.default.get, 'function');
    assert.equal(mod.VERSION, packageJson.version);
});

void test('CommonJS build can be required', () => {
    const mod = require('../../dist/cjs/index.js') as typeof PackageEntry;
    assert.equal(typeof mod.default, 'function');
    assert.equal(typeof mod.default.create, 'function');
    assert.equal(mod.VERSION, packageJson.version);
});

void test('browser build uses fetch without Node core imports', async () => {
    for (const file of [
        'dist/esm/browser.js',
        'dist/esm/core/BrowserClient.js',
        'dist/esm/core/BrowserNeutrx.js',
        'dist/esm/adapters/browser.js',
    ]) {
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /node:/);
    }

    const originalFetch = globalThis.fetch;
    const globalWithFetch = globalThis as typeof globalThis & { fetch: typeof fetch };
    globalWithFetch.fetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => Promise.resolve(new Response(
        JSON.stringify({ ok: true, method: init?.method ?? 'GET' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
    ));

    try {
        const mod = await import(browserEntry) as typeof PackageEntry;
        const api = mod.default.create({ baseURL: 'https://browser.example' });
        const response = await api.get<{ readonly ok: boolean; readonly method: string }>('/health');

        assert.equal(mod.VERSION, packageJson.version);
        assert.deepEqual(response.data, { ok: true, method: 'GET' });
    } finally {
        globalWithFetch.fetch = originalFetch;
    }
});

void test('mock plugin returns typed response through callable client', async () => {
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
    const events: PackageEntry.ProgressEvent[] = [];

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
                events.push(event);
                if (event.percent !== undefined) progress.push(event.percent);
            },
        });

        assert.equal(response.data.received, payload.length);
        assert.deepEqual(progress, [0, 25, 50, 75, 100]);
        assert.equal(events.at(-1)?.bytes, 16 * 1024);
        assert.equal(events.at(-1)?.upload, true);
        assert.equal(typeof events.at(-1)?.rate, 'number');
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

void test('interceptors, serializers, transforms, and download progress work', async () => {
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
            paramsSerializer: params => `custom=${String(params.custom)}`,
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

void test('custom adapter participates in Neutrx parsing and validation', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({ method: config.method, url: config.url })),
            config,
        }),
    });

    const response = await api.get('https://example.com/users', { params: { page: 2 } });
    assert.deepEqual(response.data, { method: 'GET', url: 'https://example.com/users?page=2' });
});

void test('named fetch adapter works through native fetch', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const server = http.createServer((_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ ok: true }));
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            adapter: 'fetch',
            baseURL: `http://127.0.0.1:${address.port}`,
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        const response = await api.get('/fetch');
        assert.deepEqual(response.data, { ok: true });
    } finally {
        await close(server);
    }
});

void test('global defaults merge into root requests and new instances', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const previousDefaults = { ...Neutrx.defaults };
    Neutrx.defaults.baseURL = 'https://defaults.example';
    Neutrx.defaults.timeout = 1234;
    Neutrx.defaults.headers = { 'X-Default': 'yes' };

    try {
        const root = await Neutrx.get('/root', {
            adapter: config => ({
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({
                    url: config.url,
                    timeout: config.timeout,
                    header: config.headers['X-Default'],
                })),
                config,
            }),
        });
        assert.deepEqual(root.data, {
            url: 'https://defaults.example/root',
            timeout: 1234,
            header: 'yes',
        });
        assert.equal(Neutrx.getUri('/uri'), 'https://defaults.example/uri');

        const api = Neutrx.create({
            headers: { 'X-Default': 'override' },
            adapter: config => ({
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({
                    url: config.url,
                    timeout: config.timeout,
                    header: config.headers['X-Default'],
                })),
                config,
            }),
        });
        const response = await api.get('/instance');
        assert.deepEqual(response.data, {
            url: 'https://defaults.example/instance',
            timeout: 1234,
            header: 'override',
        });
    } finally {
        for (const key of Object.keys(Neutrx.defaults) as Array<keyof typeof Neutrx.defaults>) delete Neutrx.defaults[key];
        Object.assign(Neutrx.defaults, previousDefaults);
    }
});

void test('node http adapter exposes response request reference and honors maxRate upload', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const payload = Buffer.alloc(320, 'r');
    const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ received: Buffer.concat(chunks).length }));
        });
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            adapter: 'http',
            baseURL: `http://127.0.0.1:${address.port}`,
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });
        const started = Date.now();
        const response = await api.post<{ readonly received: number }, Buffer>('/rate', payload, { maxRate: [1600, 0] });

        assert.equal(response.data.received, payload.length);
        assert.ok(response.request && typeof (response.request as { destroy?: unknown }).destroy === 'function');
        assert.ok(Date.now() - started >= 100);
    } finally {
        await close(server);
    }
});

void test('isNeutrxError narrows Neutrx errors', async () => {
    const { default: Neutrx, isNeutrxError } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({ security: { enforceHTTPS: false, enableSSRFProtection: false } });

    try {
        await api.request({ url: 'http://example.com/', method: 'TRACE' as never });
        assert.fail('request should throw');
    } catch (error: unknown) {
        assert.equal(isNeutrxError(error), true);
        assert.equal(Object.keys(error as object).includes('__isNeutrxError'), false);
    }
});

void test('getUri builds final URL without dispatching', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        baseURL: 'https://api.example.com/v1',
        paramsSerializer: params => `page=${String(params.page)}`,
    });

    assert.equal(api.getUri({ url: '/users', params: { page: 2 } }), 'https://api.example.com/v1/users?page=2');
});

void test('decompress false keeps compressed response bytes', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const payload = Buffer.from(JSON.stringify({ ok: true }));
    const zipped = zlib.gzipSync(payload);
    const server = http.createServer((_request, response) => {
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
            decompress: false,
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        const response = await api.get<Buffer>('/gzip', { responseType: 'buffer' });
        assert.equal(Buffer.compare(response.data, zipped), 0);
    } finally {
        await close(server);
    }
});

void test('synchronous request interceptors run before async chain begins', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const order: string[] = [];
    const api = Neutrx.create({
        adapter: config => {
            order.push(String(config.headers['X-Sync']));
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from('{}'),
                config,
            };
        },
    });

    api.useRequest(config => {
        order.push('sync');
        return { ...config, headers: { ...config.headers, 'X-Sync': 'yes' } };
    }, undefined, { synchronous: true });
    api.useRequest(async config => {
        await Promise.resolve();
        order.push('async');
        return config;
    });

    await api.get('https://example.com/');
    assert.deepEqual(order, ['sync', 'async', 'yes']);
});

void test('FormData bodies serialize as multipart with boundary and length', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const captured: { contentType?: string; length?: string; body?: string } = {};
    const server = http.createServer((request, response) => {
        const contentType = headerValue(request.headers['content-type']);
        const length = headerValue(request.headers['content-length']);
        if (contentType !== undefined) captured.contentType = contentType;
        if (length !== undefined) captured.length = length;
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            captured.body = Buffer.concat(chunks).toString('utf8');
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ok: true }));
        });
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });
        const form = new FormData();
        form.set('name', 'Ada');
        form.set('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');

        await api.post('/multipart', form);

        assert.match(captured.contentType ?? '', /^multipart\/form-data; boundary=----neutrx-/);
        assert.ok(Number(captured.length) > 0);
        assert.match(captured.body ?? '', /name="name"\r\n\r\nAda/);
        assert.match(captured.body ?? '', /filename="hello.txt"\r\nContent-Type: text\/plain/);
        assert.match(captured.body ?? '', /\r\nhello\r\n/);
    } finally {
        await close(server);
    }
});

void test('postForm serializes plain objects as multipart form data', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const captured: { contentType: string | undefined; body?: string } = { contentType: undefined };
    const server = http.createServer((request, response) => {
        captured.contentType = headerValue(request.headers['content-type']);
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            captured.body = Buffer.concat(chunks).toString('utf8');
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ok: true }));
        });
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        await api.postForm('/form', { name: 'Ada', role: 'admin' });

        assert.match(captured.contentType ?? '', /^multipart\/form-data; boundary=----neutrx-/);
        assert.match(captured.body ?? '', /name="name"\r\n\r\nAda/);
        assert.match(captured.body ?? '', /name="role"\r\n\r\nadmin/);
    } finally {
        await close(server);
    }
});

void test('NeutrxError toJSON redacts secrets from URL, headers, and data', async () => {
    const { default: Neutrx, isNeutrxError } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        resilience: { enableRetry: false },
        adapter: config => ({
            status: 500,
            statusText: 'Internal Server Error',
            headers: {
                'content-type': 'application/json',
                'set-cookie': 'sid=secret-cookie',
                'retry-after': '1',
            },
            data: Buffer.from(JSON.stringify({
                ok: false,
                token: 'secret-token',
                nested: { password: 'secret-password' },
            })),
            config,
        }),
    });

    try {
        await api.get('https://api.example.com/fail?access_token=secret-query', {
            headers: { Authorization: 'Bearer secret-header' },
        });
        assert.fail('request should throw');
    } catch (error: unknown) {
        assert.equal(isNeutrxError(error), true);
        const rendered = JSON.stringify((error as { readonly toJSON: () => unknown }).toJSON());
        assert.doesNotMatch(rendered, /secret-query|secret-header|secret-token|secret-password|secret-cookie/u);
        assert.match(rendered, /\[REDACTED\]/u);
    }
});

void test('HTTP proxy config sends absolute-form requests with proxy auth', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const captured: { url?: string; host?: string; auth?: string } = {};
    const proxy = http.createServer((request, response) => {
        const host = headerValue(request.headers.host);
        const auth = headerValue(request.headers['proxy-authorization']);
        if (request.url !== undefined) captured.url = request.url;
        if (host !== undefined) captured.host = host;
        if (auth !== undefined) captured.auth = auth;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ proxied: true }));
    });
    await listen(proxy);

    try {
        const address = proxy.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            proxy: {
                host: '127.0.0.1',
                port: address.port,
                auth: { username: 'proxy-user', password: 'proxy-pass' },
            },
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        const response = await api.get('http://127.0.0.1:65530/resource?x=1');

        assert.deepEqual(response.data, { proxied: true });
        assert.equal(captured.url, 'http://127.0.0.1:65530/resource?x=1');
        assert.equal(captured.host, '127.0.0.1:65530');
        assert.equal(captured.auth, `Basic ${Buffer.from('proxy-user:proxy-pass').toString('base64')}`);
    } finally {
        await close(proxy);
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

function headerValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value.join(', ');
    return value;
}
