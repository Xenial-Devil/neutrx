import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { IncomingMessage } from 'node:http';
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
