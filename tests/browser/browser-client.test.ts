import assert from 'node:assert/strict';
import test from 'node:test';
import type * as BrowserEntry from '../../src/browser.js';
import type { NeutrxInstance } from '../../src/browser.js';

const browserEntry = '../../../dist/browser.mjs';

type MutableGlobal = typeof globalThis & {
    fetch: typeof fetch;
    EventSource?: typeof EventSource;
};

type SeenRequest = {
    readonly url: string;
    readonly method: string | undefined;
    readonly headers: Headers;
    readonly body: string;
};

void test('browser root callable merges mutable defaults into shorthands', async () => {
    const originalFetch = globalThis.fetch;
    const captured: SeenRequest[] = [];
    const globalWithFetch = globalThis as MutableGlobal;

    globalWithFetch.fetch = (input, init): Promise<Response> => {
        captured.push({
            url: requestUrl(input),
            method: init?.method,
            headers: new Headers(init?.headers),
            body: renderBody(init?.body),
        });
        return Promise.resolve(jsonResponse({ method: init?.method ?? 'GET', ok: true }));
    };

    const mod = await import(browserEntry) as typeof BrowserEntry;
    const defaults = mod.default.defaults as Record<string, unknown>;
    const previousDefaults = { ...defaults };

    try {
        resetRecord(defaults);
        mod.default.defaults.baseURL = 'https://defaults.example/v1';
        mod.default.defaults.headers = { 'X-Global': 'yes' };

        const callable = await mod.default('/callable', { cache: false });
        await mod.default.postUrlEncoded('/form', {
            a: [1, 2],
            nested: { ok: true },
            empty: null,
        }, { cache: false });
        const uri = mod.default.getUri({
            url: '/search',
            params: { tag: ['a', 'b'], nested: { id: 7 }, skip: null },
            paramsSerializer: { indexes: false },
        });

        const first = captured.at(0);
        const second = captured.at(1);
        assert.ok(first);
        assert.ok(second);
        assert.deepEqual(callable.data, { method: 'GET', ok: true });
        assert.equal(first.url, 'https://defaults.example/v1/callable');
        assert.equal(first.headers.get('X-Global'), 'yes');
        assert.equal(second.method, 'POST');
        assert.equal(second.headers.get('Content-Type'), 'application/x-www-form-urlencoded;charset=utf-8');
        assert.equal(second.body, 'a=1&a=2&nested%5Bok%5D=true');
        assert.equal(uri, 'https://defaults.example/v1/search?tag%5B%5D=a&tag%5B%5D=b&nested%5Bid%5D=7');
    } finally {
        resetRecord(defaults);
        Object.assign(defaults, previousDefaults);
        globalWithFetch.fetch = originalFetch;
    }
});

void test('browser instance defaults are mutable after creation', async () => {
    const originalFetch = globalThis.fetch;
    const captured: SeenRequest[] = [];
    const globalWithFetch = globalThis as MutableGlobal;

    globalWithFetch.fetch = (input, init): Promise<Response> => {
        captured.push({
            url: requestUrl(input),
            method: init?.method,
            headers: new Headers(init?.headers),
            body: renderBody(init?.body),
        });
        return Promise.resolve(jsonResponse({ ok: true }));
    };

    try {
        const mod = await import(browserEntry) as typeof BrowserEntry;
        const api = mod.default.create({
            baseURL: 'https://initial-browser.example',
            timeout: 1000,
            performance: { enableCaching: false },
            resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
        });

        try {
            api.defaults.baseURL = 'https://tenant-browser.example/v2';
            api.defaults.timeout = 10_000;
            api.defaults.headers.common.Authorization = 'Bearer browser-token';

            await api.get('/users', { cache: false });
            await api.get('/users', {
                baseURL: 'https://request-browser.example',
                headers: { Authorization: 'Bearer request-token' },
                cache: false,
            });

            assert.equal(captured.at(0)?.url, 'https://tenant-browser.example/v2/users');
            assert.equal(captured.at(0)?.headers.get('Authorization'), 'Bearer browser-token');
            assert.equal(captured.at(1)?.url, 'https://request-browser.example/users');
            assert.equal(captured.at(1)?.headers.get('Authorization'), 'Bearer request-token');
        } finally {
            destroyClient(api);
        }
    } finally {
        globalWithFetch.fetch = originalFetch;
    }
});

void test('browser client covers shorthands, controls, and browser-only guards', async () => {
    const originalFetch = globalThis.fetch;
    const captured: SeenRequest[] = [];
    const globalWithFetch = globalThis as MutableGlobal;

    globalWithFetch.fetch = (input, init): Promise<Response> => {
        const url = requestUrl(input);
        captured.push({
            url,
            method: init?.method,
            headers: new Headers(init?.headers),
            body: renderBody(init?.body),
        });
        if (init?.method === 'HEAD') return Promise.resolve(new Response(null, { status: 204 }));
        return Promise.resolve(jsonResponse({ ok: true, url }));
    };

    try {
        const mod = await import(browserEntry) as typeof BrowserEntry;
        const api = mod.default.create({
            baseURL: 'https://browser.example',
            performance: { enableCaching: false },
            resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
            transformRequest: (data, headers) => {
                headers['X-Transformed'] = 'yes';
                return data;
            },
            transformResponse: data => isJsonObject(data) ? { ...data, transformed: true } : data,
        });
        try {
            let successEvents = 0;
            const onSuccess = (): void => {
                successEvents += 1;
            };
            api.on('request:success', onSuccess);

            api.setBaseURL('https://browser.example/api')
                .setTimeout(250)
                .setHeader('X-Client', 'one')
                .setAuth({ bearer: 'secret' });

            const post = await api.post('/post', { name: 'Ada' });
            api.clearAuth();
            await api.put('/put', 'plain');
            await api.patch('/patch', new Uint8Array([1, 2, 3]), { responseType: 'text' });
            await api.delete('/delete');
            await api.head('/head');
            await api.options('/options');
            await api.upload('/upload', new URLSearchParams({ q: 'one' }));
            const download = await api.download('/download');
            await api.putForm('/form', {
                blob: new Blob(['x']),
                count: 2,
                nested: { ok: true },
                tag: Symbol('sym'),
                fn: namedField,
            });
            await api.patchUrlEncoded('/encoded', { a: [1, 2], nested: { ok: true }, enabled: false });

            api.off('request:success', onSuccess);
            await api.get('/after-off');

            const methods = captured.map(item => item.method);
            const first = captured.at(0);
            const second = captured.at(1);
            assert.ok(first);
            assert.ok(second);
            assert.deepEqual(post.data, { ok: true, transformed: true, url: 'https://browser.example/api/post' });
            assert.equal(first.headers.get('Authorization'), 'Bearer secret');
            assert.equal(first.headers.get('X-Client'), 'one');
            assert.equal(first.headers.get('X-Transformed'), 'yes');
            assert.equal(second.headers.has('Authorization'), false);
            assert.deepEqual(methods, ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'POST', 'GET', 'PUT', 'PATCH', 'GET']);
            assert.ok(download.data instanceof ArrayBuffer);
            assert.equal(captured.at(8)?.body, 'blob:blob:1|count:2|nested:{"ok":true}|tag:sym|fn:namedField');
            assert.equal(captured.at(9)?.body, 'a=1&a=2&nested%5Bok%5D=true&enabled=false');
            assert.equal(successEvents, 10);
            assert.match(api.getMetricsPrometheus(), /neutrx_requests_total/u);
            assert.ok(api.getMetrics().requests.success >= 11);
            assert.equal(api.getCacheStats().hitRate, '0%');
            assert.ok(api.getCircuitStatus());
            assert.ok(api.getBulkheadStats());
            assert.equal(api.getEgressPolicy().mode, 'custom');
            assert.throws(() => api.pinCertificate(), /Node-only/u);
            assert.throws(() => api.enableRequestSigning(), /Node-only/u);

            api.blockDomain('blocked.example');
            await assert.rejects(api.get('https://blocked.example/api'), /Blocked domain/u);

            api.clearCache();
            api.resetMetrics();
            assert.equal(api.getMetrics().requests.total, 0);
        } finally {
            destroyClient(api);
        }
    } finally {
        globalWithFetch.fetch = originalFetch;
    }
});

void test('browser client orchestration helpers and pagination work with fetch', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    const globalWithFetch = globalThis as MutableGlobal;

    globalWithFetch.fetch = async (input): Promise<Response> => {
        const url = requestUrl(input);
        calls.push(url);
        if (url.includes('/slow')) await sleep(15);
        if (url.includes('/fail')) return new Response('boom', { status: 500, statusText: 'Nope' });
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/pages')) {
            const page = parsed.searchParams.get('page') ?? '1';
            return jsonResponse({ data: [`p${page}`], hasMore: page === '1' });
        }
        return jsonResponse({ path: parsed.pathname, query: parsed.search });
    };

    try {
        const mod = await import(browserEntry) as typeof BrowserEntry;
        const api = mod.default.create({
            baseURL: 'https://browser.example',
            performance: { enableCaching: false },
            resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
        });

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
            () => ({ url: '/step-two' }),
        ]);
        assert.deepEqual(sequential.map(response => response.data), [
            { path: '/step-one', query: '' },
            { path: '/step-two', query: '' },
        ]);

        const raced = await api.race([{ url: '/race-one' }, () => ({ url: '/race-two' })]);
        assert.ok(isRecord(raced.data));
        assert.match(String(raced.data.path), /^\/race-/u);

        const hedged = await api.hedged([{ url: '/hedge-one' }, { url: '/hedge-two' }], { delay: 0 });
        assert.ok(isRecord(hedged.data));
        assert.match(String(hedged.data.path), /^\/hedge-/u);

        const pages: string[][] = [];
        for await (const page of api.paginate<string[]>('/pages', { pageSize: 1, maxPages: 3 })) {
            pages.push(page.data);
        }
        assert.deepEqual(pages, [['p1'], ['p2']]);
        assert.ok(calls.some(url => url.includes('/pages?page=1&limit=1')));
        api.destroy();
    } finally {
        globalWithFetch.fetch = originalFetch;
    }
});

void test('browser SSE helper uses EventSource and reports events', async () => {
    const browserGlobal = globalThis as MutableGlobal;
    const originalEventSource = browserGlobal.EventSource;
    const messages: unknown[] = [];
    const errors: string[] = [];
    let closed = false;

    class FakeEventSource {
        static last: FakeEventSource | undefined;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        readonly listeners = new Map<string, Set<() => void>>();
        didClose = false;

        constructor(readonly url: string) {
            FakeEventSource.last = this;
        }

        addEventListener(event: string, listener: () => void): void {
            const listeners = this.listeners.get(event) ?? new Set<() => void>();
            listeners.add(listener);
            this.listeners.set(event, listeners);
        }

        close(): void {
            this.didClose = true;
        }

        emitMessage(data: string): void {
            this.onmessage?.({ data } as MessageEvent);
        }

        emitError(): void {
            this.onerror?.({} as Event);
        }

        emitClose(): void {
            this.listeners.get('close')?.forEach(listener => listener());
        }
    }

    browserGlobal.EventSource = FakeEventSource as unknown as typeof EventSource;

    try {
        const mod = await import(browserEntry) as typeof BrowserEntry;
        const api = mod.default.create({ baseURL: 'https://events.example' });
        const handle = await api.sse('/stream', {
            onMessage: message => messages.push(message),
            onError: error => errors.push(error.message),
            onClose: () => {
                closed = true;
            },
        });

        const source = FakeEventSource.last;
        assert.ok(source);
        assert.equal(source.url, 'https://events.example/stream');
        source.emitMessage('{"ok":true}');
        source.emitMessage('plain');
        source.emitError();
        source.emitClose();
        handle.close();

        assert.deepEqual(messages, [{ ok: true }, 'plain']);
        assert.deepEqual(errors, ['SSE connection error']);
        assert.equal(closed, true);
        assert.equal(source.didClose, true);
        api.destroy();
    } finally {
        if (originalEventSource) {
            browserGlobal.EventSource = originalEventSource;
        } else {
            delete browserGlobal.EventSource;
        }
    }
});

function jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return input.url;
}

function renderBody(body: RequestInit['body'] | undefined): string {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) {
        return Array.from(body.entries())
            .map(([key, value]) => `${key}:${typeof value === 'string' ? value : `blob:${value.size}`}`)
            .join('|');
    }
    if (body instanceof ArrayBuffer) return `array:${body.byteLength}`;
    if (ArrayBuffer.isView(body)) return `view:${body.byteLength}`;
    if (body instanceof Blob) return `blob:${body.size}`;
    return '[stream]';
}

function resetRecord(record: Record<string, unknown>): void {
    for (const key of Object.keys(record)) delete record[key];
}

function namedField(): void {
    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return isRecord(value)
        && !(value instanceof ArrayBuffer)
        && !ArrayBuffer.isView(value)
        && !(value instanceof URLSearchParams)
        && !(value instanceof Blob)
        && !(value instanceof FormData);
}

function destroyClient(client: NeutrxInstance): void {
    client.destroy();
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
