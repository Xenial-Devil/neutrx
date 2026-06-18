import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http, { type IncomingMessage } from 'node:http';
import { Readable, type Duplex } from 'node:stream';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';
import type { InternalRequestConfig, RawHttpResponse, RequestBody } from '../../../src/types.js';

const builtEntry = '../../../../dist/index.mjs';

type CapturedRequest = {
    readonly method: string;
    readonly url: string;
    readonly headers: Record<string, unknown>;
    readonly body: string;
};

void test('node client shorthands and controls dispatch through custom adapter', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const captured: CapturedRequest[] = [];
    const adapter = makeAdapter(captured);
    const root = await Neutrx('https://root.example/health', { adapter, cache: false });
    assert.deepEqual(root.data, {
        method: 'GET',
        url: 'https://root.example/health',
        body: '',
    });

    const api = Neutrx.create({
        baseURL: 'https://node.example',
        adapter,
        performance: { enableCaching: false },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
        transformRequest: (data, headers) => {
            headers['X-Transformed'] = 'yes';
            return data;
        },
        transformResponse: data => isJsonObject(data) ? { ...data, transformed: true } : data,
    });

    try {
        const recoverId = api.useResponse(undefined, error => ({
            status: 209,
            statusText: 'Recovered',
            headers: { 'content-type': 'application/json' },
            data: { message: error.message },
            config: fallbackConfig(),
            requestId: 'recovered',
            timing: { duration: 0 },
        }));
        let successEvents = 0;
        api.on('request:success', () => {
            successEvents += 1;
        });
        api.setBaseURL('https://node.example/api')
            .setTimeout(300)
            .setHeader('X-Client', 'one')
            .setAuth({ basic: { username: 'ada', password: 'lovelace' } });

        const post = await api.post('/post', { name: 'Ada' });
        api.clearAuth();
        await api.put('/put', 'plain');
        await api.patch('/patch', Buffer.from('bytes'), { responseType: 'text' });
        await api.delete('/delete');
        await api.head('/head');
        await api.options('/options');
        await api.upload('/upload', new URLSearchParams({ q: 'one' }));
        const download = await api.download('/download');
        await api.putForm('/form', { name: 'Ada', count: 2 });
        await api.patchUrlEncoded('/encoded', { a: [1, 2], nested: { ok: true } });

        const rootCall = captured.at(0);
        const first = captured.at(1);
        const second = captured.at(2);
        assert.ok(rootCall);
        assert.ok(first);
        assert.ok(second);
        assert.deepEqual(post.data, {
            method: 'POST',
            url: 'https://node.example/api/post',
            body: '{"name":"Ada"}',
            transformed: true,
        });
        assert.equal(first.headers.authorization, 'Basic YWRhOmxvdmVsYWNl');
        assert.equal(first.headers['x-client'], 'one');
        assert.equal(first.headers['x-transformed'], 'yes');
        assert.equal(second.headers.authorization, undefined);
        assert.deepEqual(captured.slice(1).map(item => item.method), [
            'POST',
            'PUT',
            'PATCH',
            'DELETE',
            'HEAD',
            'OPTIONS',
            'POST',
            'GET',
            'PUT',
            'PATCH',
        ]);
        assert.ok(Buffer.isBuffer(download.data));
        assert.equal(captured.at(9)?.headers['content-type'], 'multipart/form-data');
        assert.equal(captured.at(9)?.body, '{"name":"Ada","count":2}');
        assert.equal(captured.at(10)?.headers['content-type'], 'application/x-www-form-urlencoded;charset=utf-8');
        assert.equal(captured.at(10)?.body, '{"a":[1,2],"nested":{"ok":true}}');
        assert.equal(successEvents, 10);
        assert.match(api.getMetricsPrometheus(), /neutrx_requests_total/u);
        assert.ok(api.getMetrics().requests.total >= 10);
        assert.equal(api.getCacheStats().hitRate, '0%');
        assert.ok(api.getCircuitStatus());
        assert.ok(api.getBulkheadStats());
        assert.ok(api.getEgressPolicy());

        api.setAuth({ apiKey: { key: 'api-key', header: 'X-Api-Key' } });
        await api.get('/api-key');
        assert.equal(captured.at(-1)?.headers['x-api-key'], 'api-key');
        api.setAuth({ bearer: 'bearer-token' });
        await api.get('/bearer');
        assert.equal(captured.at(-1)?.headers.authorization, 'Bearer bearer-token');
        api.removeHeader('X-Client').clearAuth();
        await api.get('/removed');
        assert.equal(captured.at(-1)?.headers['x-client'], undefined);
        assert.equal(captured.at(-1)?.headers.authorization, undefined);
        assert.equal(successEvents, 13);

        const recovered = await api.get('/boom', {
            adapter: failingConfig => {
                throw Object.assign(new Error('adapter boom'), { code: 'ECONNRESET', config: failingConfig });
            },
        });
        assert.equal(recovered.status, 209);
        api.eject(recoverId);

        api.pinCertificate('node.example', 'a'.repeat(64));
        api.enableRequestSigning('secret');
        api.setLogger(undefined);
        api.blockDomain('blocked.example');
        await assert.rejects(api.get('https://blocked.example/api'), /Blocked domain/u);

        api.clearCache();
        api.resetMetrics();
        assert.equal(api.getMetrics().requests.total, 0);
    } finally {
        api.destroy();
    }
});

void test('node client keeps NeutrxHeaders through interceptors and deduplicates casing', async () => {
    const { default: Neutrx, NeutrxHeaders } = await import(builtEntry) as typeof PackageEntry;
    let firstInterceptorSawHeaders = false;
    let secondInterceptorSawHeaders = false;
    let capturedEntries: Array<[string, unknown]> = [];
    const api = Neutrx.create({
        baseURL: 'https://headers.example',
        adapter: (config): RawHttpResponse => {
            capturedEntries = Object.entries(config.headers);
            return jsonRaw(config, { ok: true });
        },
        performance: { enableCaching: false },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    });

    try {
        api.interceptors.request.use(config => {
            firstInterceptorSawHeaders = config.headers instanceof NeutrxHeaders;
            assert.equal(config.headers.get('content-type'), 'application/second');
            config.headers.set('CONTENT-TYPE', 'application/interceptor');
            return { ...config, headers: { ...config.headers, 'X-Plain': 'yes' } };
        });
        api.interceptors.request.use(config => {
            secondInterceptorSawHeaders = config.headers instanceof NeutrxHeaders;
            assert.equal(config.headers.get('x-plain'), 'yes');
            return config;
        });

        await api.post('/headers', { ok: true }, {
            headers: {
                'Content-Type': 'application/first',
                'content-type': 'application/second',
            },
        });

        assert.equal(firstInterceptorSawHeaders, true);
        assert.equal(secondInterceptorSawHeaders, true);
        assert.deepEqual(capturedEntries.filter(([name]) => name.toLowerCase() === 'content-type'), [
            ['Content-Type', 'application/interceptor'],
        ]);
    } finally {
        api.destroy();
    }
});

void test('node requests normalize plain objects and NeutrxHeaders before hooks and adapters', async () => {
    const { default: Neutrx, NeutrxHeaders } = await import(builtEntry) as typeof PackageEntry;
    const seenByInterceptor: boolean[] = [];
    const authorizations: unknown[] = [];
    const collection = new NeutrxHeaders({ Authorization: 'Bearer collection' });
    const api = Neutrx.create({
        baseURL: 'https://headers.example',
        adapter: config => {
            assert.ok(config.headers instanceof NeutrxHeaders);
            authorizations.push(config.headers.get('Authorization'));
            return jsonRaw(config, { ok: true });
        },
        performance: { enableCaching: false },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    });

    try {
        api.interceptors.request.use(config => {
            seenByInterceptor.push(config.headers instanceof NeutrxHeaders);
            return config;
        });

        await api.get('/plain', { headers: { Authorization: 'Bearer plain' } });
        await api.get('/collection', { headers: collection });

        assert.deepEqual(seenByInterceptor, [true, true]);
        assert.deepEqual(authorizations, ['Bearer plain', 'Bearer collection']);
        assert.equal(collection.get('Authorization'), 'Bearer collection');
    } finally {
        api.destroy();
    }
});

void test('node client false header sentinel blocks automatic content-type', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let capturedEntries: Array<[string, unknown]> = [];
    const api = Neutrx.create({
        baseURL: 'https://headers.example',
        adapter: (config): RawHttpResponse => {
            capturedEntries = Object.entries(config.headers);
            return jsonRaw(config, { ok: true });
        },
        performance: { enableCaching: false },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    });

    try {
        await api.post('/headers', { ok: true }, { headers: { 'Content-Type': false } });
        assert.equal(capturedEntries.some(([name]) => name.toLowerCase() === 'content-type'), false);
    } finally {
        api.destroy();
    }
});

void test('node client validates response schema and can disable it per request', async () => {
    const { default: Neutrx, NeutrxValidationError, createTraceContextPlugin } = await import(builtEntry) as typeof PackageEntry;
    let calls = 0;
    const userSchema = {
        safeParse(value: unknown) {
            if (isJsonObject(value) && typeof value.id === 'number' && typeof value.name === 'string') {
                return { success: true as const, data: { id: String(value.id), name: value.name.trim() } };
            }
            return { success: false as const, issues: [{ path: ['id'], message: 'id must be number', code: 'invalid_type' }] };
        },
    } satisfies PackageEntry.ResponseValidationSchema<{ readonly id: string; readonly name: string }>;
    const api = Neutrx.create({
        baseURL: 'https://schema.example',
        schema: userSchema,
        adapter: config => {
            calls += 1;
            return jsonRaw(config, config.url.endsWith('/valid')
                ? { id: 123, name: ' Ada ' }
                : { id: 'bad', name: 'Ada' });
        },
        performance: { enableCaching: false },
        resilience: { enableRetry: true, enableCircuitBreaker: false, enableBulkhead: false },
    });
    api.use(createTraceContextPlugin({
        context: {
            traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            spanId: 'bbbbbbbbbbbbbbbb',
            sampled: true,
        },
    }));

    try {
        const valid = await api.get('/valid', { schema: userSchema });
        const typedId: string = valid.data.id;
        assert.equal(typedId, '123');
        assert.deepEqual(valid.data, { id: '123', name: 'Ada' });

        await assert.rejects(
            api.get('/invalid'),
            error => error instanceof NeutrxValidationError
                && error.phase === 'response'
                && error.category === 'validation'
                && error.traceContext?.traceId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
                && error.issues[0]?.path?.[0] === 'id'
                && error.issues[0]?.code === 'invalid_type'
        );

        const disabled = await api.get('/invalid', { schema: false });
        assert.deepEqual(disabled.data, { id: 'bad', name: 'Ada' });
        assert.equal(calls, 3);
    } finally {
        api.destroy();
    }
});

void test('node client orchestration helpers, pagination, and SSE work with custom adapter', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const captured: CapturedRequest[] = [];
    const adapter = makeAdapter(captured, { slowMs: 15 });
    const api = Neutrx.create({
        baseURL: 'https://orchestration.example',
        adapter,
        performance: { enableCaching: false },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    });

    try {
        const progress: string[] = [];
        const concurrent = await api.concurrent([
            { url: '/ok' },
            () => ({ url: '/fail' }),
        ], {
            limit: 1,
            onProgress: (completed, total, index, error) => progress.push(`${completed}/${total}:${index}:${error ? 'error' : 'ok'}`),
        });
        assert.equal(concurrent.completed, 2);
        assert.ok(concurrent.results[0]);
        assert.ok(concurrent.errors[1] instanceof Error);
        assert.deepEqual(progress, ['1/2:0:ok', '2/2:1:error']);
        await assert.rejects(api.concurrent([{ url: '/slow' }], { timeout: 1 }), /concurrent timeout/u);

        const sequential = await api.sequential([
            { url: '/step-one' },
            previous => ({ url: `/step-two?prev=${String((previous?.data as { readonly url?: string } | undefined)?.url ?? '')}` }),
        ]);
        assert.equal((sequential.at(1)?.data as { readonly url?: string } | undefined)?.url, 'https://orchestration.example/step-two?prev=https://orchestration.example/step-one');

        const raced = await api.race([{ url: '/race-one' }, () => ({ url: '/race-two' })]);
        assert.match(String((raced.data as { readonly url: string }).url), /\/race-/u);

        const hedged = await api.hedged([{ url: '/hedge-one' }, { url: '/hedge-two' }], { delay: 0 });
        assert.match(String((hedged.data as { readonly url: string }).url), /\/hedge-/u);

        const pages: string[][] = [];
        for await (const page of api.paginate<string[]>('/pages', { pageSize: 1, maxPages: 3 })) {
            pages.push(page.data);
        }
        assert.deepEqual(pages, [['p1'], ['p2']]);

        const messages: unknown[] = [];
        const errors: string[] = [];
        let closed = false;
        const handle = await api.sse('/events', {
            onMessage: message => messages.push(message),
            onError: error => errors.push(error.message),
            onClose: () => {
                closed = true;
            },
        });
        await new Promise(resolve => {
            setImmediate(resolve);
        });
        handle.close();

        assert.deepEqual(messages, [{ ok: true }, 'plain']);
        assert.deepEqual(errors, []);
        assert.equal(closed, true);
        assert.ok(captured.some(item => item.url.includes('/pages?page=1&limit=1')));
    } finally {
        api.destroy();
    }
});

void test('node paginate supports total-count, cursor, and link-header strategies', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;

    const adapter = (config: InternalRequestConfig<RequestBody>): RawHttpResponse => {
        const parsed = new URL(config.url);

        if (parsed.pathname === '/total') {
            const page = Number(parsed.searchParams.get('page') ?? '1');
            return jsonRaw(config, { data: [`t${page}a`, `t${page}b`], total: 5 });
        }
        if (parsed.pathname === '/cursor') {
            const cursor = parsed.searchParams.get('cursor');
            if (cursor === null) return jsonRaw(config, { data: ['c1'], nextCursor: 'A' });
            if (cursor === 'A') return jsonRaw(config, { data: ['c2'], nextCursor: 'B' });
            return jsonRaw(config, { data: ['c3'], nextCursor: null });
        }
        // /link
        const page = Number(parsed.searchParams.get('page') ?? '1');
        const next = page < 2 ? `<https://pg.example/link?page=${page + 1}>; rel="next"` : '';
        return {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json', link: next },
            data: Buffer.from(JSON.stringify({ data: [`l${page}`] })),
            config,
        };
    };

    const api = Neutrx.create({
        baseURL: 'https://pg.example',
        adapter,
        performance: { enableCaching: false },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    });

    try {
        // total-count: 5 items, pageSize 2 → stop after 3 pages (4 < 5, 6 >= 5).
        const totalPages: string[][] = [];
        for await (const page of api.paginate<string[]>('/total', { strategy: 'total-count', pageSize: 2 })) {
            totalPages.push(page.data);
        }
        assert.deepEqual(totalPages, [['t1a', 't1b'], ['t2a', 't2b'], ['t3a', 't3b']]);

        // cursor: follow nextCursor until null.
        const cursorPages: string[][] = [];
        for await (const page of api.paginate<string[]>('/cursor', { strategy: 'cursor' })) {
            cursorPages.push(page.data);
        }
        assert.deepEqual(cursorPages, [['c1'], ['c2'], ['c3']]);

        // link-header: follow rel="next" until absent.
        const linkPages: string[][] = [];
        for await (const page of api.paginate<string[]>('/link', { strategy: 'link-header' })) {
            linkPages.push(page.data);
        }
        assert.deepEqual(linkPages, [['l1'], ['l2']]);
    } finally {
        api.destroy();
    }
});

void test('node ws uses baseURL, auth headers, defaults, and request interceptors', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const upgrades: Array<{ readonly url?: string; readonly headers: http.IncomingHttpHeaders }> = [];
    const opened = deferred<void>();
    const messageReceived = deferred<string>();
    const typedMessages: Array<{ readonly ready: boolean }> = [];
    const server = http.createServer();
    const sockets = new Set<Duplex>();

    server.on('upgrade', (request, socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        upgrades.push({
            ...(request.url !== undefined ? { url: request.url } : {}),
            headers: request.headers,
        });
        acceptWebSocketUpgrade(request, socket);
        socket.write(serverTextFrame(JSON.stringify({ ready: true })));
        let buffer = Buffer.alloc(0);
        socket.on('data', chunk => {
            buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
            const parsed = readClientTextFrame(buffer);
            if (!parsed) return;
            buffer = buffer.subarray(parsed.consumed);
            if (!parsed.text) {
                socket.end();
                return;
            }
            messageReceived.resolve(parsed.text);
        });
    });

    const port = await listen(server);
    const api = Neutrx.create({
        baseURL: `http://127.0.0.1:${port}/api`,
        auth: { username: 'service', password: 'secret' },
        headers: { 'X-Default': 'yes' },
        security: { profile: 'legacy' },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
        performance: { enableCaching: false },
    });

    try {
        api.interceptors.request.use(config => ({
            ...config,
            headers: { ...config.headers, 'X-Intercepted': 'yes' },
        }));

        const connection = await api.ws<{ readonly ready: boolean }>('/realtime', {
            params: { room: 'ops' },
            parseMessage: data => JSON.parse(typeof data === 'string' ? data : '{}') as { readonly ready: boolean },
            onOpen: () => opened.resolve(),
            onMessage: data => typedMessages.push(data),
        });

        await opened.promise;
        connection.send('hello from client');

        assert.equal(await messageReceived.promise, 'hello from client');
        assert.equal(connection.url, `ws://127.0.0.1:${port}/api/realtime?room=ops`);
        assert.equal(upgrades[0]?.url, '/api/realtime?room=ops');
        assert.equal(upgrades[0]?.headers.authorization, 'Basic c2VydmljZTpzZWNyZXQ=');
        assert.equal(upgrades[0]?.headers['x-default'], 'yes');
        assert.equal(upgrades[0]?.headers['x-intercepted'], 'yes');
        await waitFor(() => typedMessages.length === 1);
        assert.deepEqual(typedMessages, [{ ready: true }]);
        connection.close();
    } finally {
        for (const socket of sockets) socket.destroy();
        api.destroy();
        await closeServer(server);
    }
});

void test('node ws reconnects with configured attempts, delay, and backoff', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const secondOpen = deferred<void>();
    const server = http.createServer();
    const sockets = new Set<Duplex>();
    let upgrades = 0;

    server.on('upgrade', (request, socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        upgrades += 1;
        acceptWebSocketUpgrade(request, socket);
        if (upgrades === 1) {
            socket.destroy();
            return;
        }
        secondOpen.resolve();
    });

    const port = await listen(server);
    const api = Neutrx.create({
        baseURL: `http://127.0.0.1:${port}`,
        security: { profile: 'legacy' },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
        performance: { enableCaching: false },
    });

    try {
        const connection = await api.ws('/reconnect', {
            reconnect: { attempts: 1, delay: 1, backoff: 'fixed' },
        });

        await secondOpen.promise;
        assert.equal(upgrades, 2);
        connection.close();
    } finally {
        for (const socket of sockets) socket.destroy();
        api.destroy();
        await closeServer(server);
    }
});

function makeAdapter(
    captured: CapturedRequest[],
    options: { readonly slowMs?: number } = {}
): (config: InternalRequestConfig<RequestBody>) => Promise<RawHttpResponse> {
    return async (config): Promise<RawHttpResponse> => {
        if (config.url.includes('/slow')) await sleep(options.slowMs ?? 1);
        captured.push({
            method: config.method,
            url: config.url,
            headers: lowerHeaders(config.headers),
            body: bodyText(config.data),
        });
        if (config.url.includes('/fail')) {
            return {
                status: 500,
                statusText: 'Nope',
                headers: { 'content-type': 'text/plain' },
                data: Buffer.from('boom'),
                config,
            };
        }
        if (config.url.includes('/events')) {
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'text/event-stream' },
                data: Readable.from(['data: {"ok":true}\n\n', 'data: plain\n\n']) as IncomingMessage,
                config,
            };
        }
        if (config.url.includes('/pages')) {
            const page = new URL(config.url).searchParams.get('page') ?? '1';
            return jsonRaw(config, { data: [`p${page}`], hasMore: page === '1' });
        }
        if (config.responseType === 'buffer') {
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/octet-stream' },
                data: Buffer.from('download'),
                config,
            };
        }
        return jsonRaw(config, {
            method: config.method,
            url: config.url,
            body: bodyText(config.data),
        });
    };
}

function jsonRaw(config: InternalRequestConfig, data: unknown): RawHttpResponse {
    return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: Buffer.from(JSON.stringify(data)),
        config,
    };
}

function bodyText(body: RequestBody | undefined): string {
    if (body === undefined || body === null) return '';
    if (typeof body === 'string') return body;
    if (Buffer.isBuffer(body)) return body.toString('utf8');
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) {
        return Array.from(body.entries())
            .map(([key, value]) => `${key}:${typeof value === 'string' ? value : `blob:${value.size}`}`)
            .join('|');
    }
    if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
    if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8');
    if (body instanceof Blob) return `blob:${body.size}`;
    return JSON.stringify(body) ?? '';
}

function lowerHeaders(headers: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && !Buffer.isBuffer(value)
        && !(value instanceof ArrayBuffer)
        && !ArrayBuffer.isView(value)
        && !(value instanceof URLSearchParams)
        && !(value instanceof Blob)
        && !(value instanceof FormData);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function deferred<T = void>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (error: Error) => void } {
    let resolveValue!: (value: T) => void;
    let rejectValue!: (error: Error) => void;
    const timeout = setTimeout(() => rejectValue(new Error('Timed out waiting for WebSocket test event')), 1000);
    const promise = new Promise<T>((resolve, reject) => {
        resolveValue = value => {
            clearTimeout(timeout);
            resolve(value);
        };
        rejectValue = error => {
            clearTimeout(timeout);
            reject(error);
        };
    });
    return { promise, resolve: resolveValue, reject: rejectValue };
}

async function listen(server: http.Server): Promise<number> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return address.port;
}

async function closeServer(server: http.Server): Promise<void> {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
        server.close(error => {
            if (error) reject(error);
            else resolve();
        });
    });
}

async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 1000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
        await sleep(5);
    }
}

function acceptWebSocketUpgrade(request: http.IncomingMessage, socket: Duplex): void {
    const key = String(request.headers['sec-websocket-key'] ?? '');
    const accept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
    socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
    ].join('\r\n'));
}

function serverTextFrame(text: string): Buffer {
    const payload = Buffer.from(text);
    if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
}

function readClientTextFrame(buffer: Buffer): { readonly text: string; readonly consumed: number } | null {
    if (buffer.length < 6) return null;
    const opcode = (buffer[0] ?? 0) & 0x0f;
    const masked = ((buffer[1] ?? 0) & 0x80) !== 0;
    let length = (buffer[1] ?? 0) & 0x7f;
    let offset = 2;
    if (length === 126) {
        if (buffer.length < offset + 2) return null;
        length = buffer.readUInt16BE(offset);
        offset += 2;
    }
    if (length === 127) throw new Error('Test frame too large');
    if (!masked) throw new Error('Client WebSocket frames must be masked');
    const maskOffset = offset;
    offset += 4;
    if (buffer.length < offset + length) return null;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    for (let index = 0; index < payload.length; index += 1) {
        payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
    }
    if (opcode === 0x8) return { text: '', consumed: offset + length };
    assert.equal(opcode, 0x1);
    return { text: payload.toString('utf8'), consumed: offset + length };
}

function fallbackConfig(): InternalRequestConfig {
    return {
        url: 'https://node.example/recovered',
        method: 'GET',
        headers: {} as InternalRequestConfig['headers'],
        allowAbsoluteUrls: true,
        timeout: 1000,
        connectTimeout: 1000,
        maxRedirects: 0,
        maxContentLength: 1024,
        maxBodyLength: 1024,
        responseType: 'json',
        responseEncoding: 'utf8',
        validateStatus: status => status >= 200 && status < 300,
        throwHttpErrors: true,
        decompress: true,
        transitional: { clarifyTimeoutError: false },
        followRedirects: true,
        requestId: 'recovered',
        startTime: Date.now(),
        hops: 0,
    };
}
