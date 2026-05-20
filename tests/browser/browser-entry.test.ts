import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import type * as BrowserAdapter from '../../src/adapters/browser.js';
import type { FetchCredentials } from '../../src/browser.js';
import type * as BrowserEntry from '../../src/browser.js';
import type { InternalRequestConfig } from '../../src/types.js';

const browserEntry = '../../../dist/esm/browser.js';
const browserAdapterEntry = '../../../dist/esm/adapters/browser.js';

void test('browser entry supports fetch, credentials, and postForm', async () => {
    const originalFetch = globalThis.fetch;
    const seen: { method: string | undefined; credentials: FetchCredentials | undefined; isFormData: boolean | undefined } = {
        method: undefined,
        credentials: undefined,
        isFormData: undefined,
    };
    const globalWithFetch = globalThis as typeof globalThis & { fetch: typeof fetch };

    globalWithFetch.fetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        seen.method = init?.method;
        seen.credentials = init?.credentials;
        seen.isFormData = init?.body instanceof FormData;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));
    };

    try {
        const mod = await import(browserEntry) as typeof BrowserEntry;
        const api = mod.default.create({ baseURL: 'https://browser.example', withCredentials: true });
        const response = await api.postForm('/form', { name: 'Ada' });

        assert.deepEqual(response.data, { ok: true });
        assert.equal(seen.method, 'POST');
        assert.equal(seen.credentials, 'include');
        assert.equal(seen.isFormData, true);
    } finally {
        globalWithFetch.fetch = originalFetch;
    }
});

void test('browser entry exposes CancelToken and preserves cancel reason', async () => {
    const originalFetch = globalThis.fetch;
    const globalWithFetch = globalThis as typeof globalThis & { fetch: typeof fetch };
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => {
        markStarted = resolve;
    });

    globalWithFetch.fetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
        const rejectAbort = (): void => {
            reject(init?.signal?.reason instanceof Error ? init.signal.reason : new Error('Request aborted'));
        };
        markStarted();
        if (init?.signal?.aborted) {
            rejectAbort();
            return;
        }
        init?.signal?.addEventListener('abort', rejectAbort, { once: true });
    });

    try {
        const mod = await import(browserEntry) as typeof BrowserEntry;
        const api = mod.default.create({ baseURL: 'https://browser.example' });
        const source = mod.CancelToken.source();
        const pending = api.get('/cancel', { cancelToken: source.token, timeout: 5000 });
        await started;
        source.cancel('browser legacy cancel');

        assert.equal(mod.default.CancelToken, mod.CancelToken);
        await assert.rejects(pending, error => mod.isCancel(error) && error.message === 'browser legacy cancel');
    } finally {
        globalWithFetch.fetch = originalFetch;
    }
});

void test('browser entry runs ValidationPlugin without Node APIs', async () => {
    const originalFetch = globalThis.fetch;
    const globalWithFetch = globalThis as typeof globalThis & { fetch: typeof fetch };

    globalWithFetch.fetch = (): Promise<Response> => Promise.resolve(new Response(JSON.stringify({ ok: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    }));

    try {
        const mod = await import(browserEntry) as typeof BrowserEntry;
        const api = mod.default.create({ baseURL: 'https://browser.example' });
        api.use(mod.ValidationPlugin);

        await assert.rejects(
            api.get('/validate', {
                validation: {
                    response: value => isRecord(value) && value.ok === true
                        ? true
                        : [{ path: ['ok'], message: 'ok must be true' }],
                },
            }),
            error => error instanceof mod.NeutrxValidationError
        );
    } finally {
        globalWithFetch.fetch = originalFetch;
    }
});

void test('browser adapter is safe in edge-like runtimes without document or window', async () => {
    const { fetchAdapter } = await import(browserAdapterEntry) as typeof BrowserAdapter;
    const browserGlobal = globalThis as MutableBrowserGlobal;
    const previous = snapshotBrowserGlobal(browserGlobal);
    let captured: RequestInit | undefined;

    delete browserGlobal.window;
    delete browserGlobal.document;
    delete browserGlobal.location;
    browserGlobal.fetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        captured = init;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));
    };

    try {
        const raw = await fetchAdapter(adapterConfig({
            data: new URLSearchParams({ q: 'neutrx' }),
            headers: { 'Content-Length': 100, 'Content-Type': 'application/x-www-form-urlencoded' },
            method: 'POST',
            url: 'https://edge.example/search',
        }));

        assert.equal(raw.status, 200);
        assert.equal(captured?.credentials, 'same-origin');
        const headers = new Headers(captured?.headers);
        assert.equal(headers.has('Content-Length'), false);
        assert.equal(headers.has('X-XSRF-TOKEN'), false);
    } finally {
        restoreBrowserGlobal(browserGlobal, previous);
    }
});

void test('browser adapter handles XSRF same-origin rules and credential precedence', async () => {
    const { fetchAdapter } = await import(browserAdapterEntry) as typeof BrowserAdapter;
    const browserGlobal = globalThis as MutableBrowserGlobal;
    const previous = snapshotBrowserGlobal(browserGlobal);
    const captured: RequestInit[] = [];

    browserGlobal.window = browserGlobal;
    browserGlobal.document = { cookie: 'XSRF-TOKEN=abc123' };
    browserGlobal.location = { href: 'https://app.example/page', origin: 'https://app.example' };
    browserGlobal.fetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        captured.push(init ?? {});
        return Promise.resolve(new Response('ok', { status: 200 }));
    };

    try {
        await fetchAdapter(adapterConfig({ url: 'https://app.example/api', withCredentials: true }));
        await fetchAdapter(adapterConfig({ url: 'https://api.example.com/data' }));
        await fetchAdapter(adapterConfig({
            credentials: 'omit',
            url: 'https://api.example.com/forced',
            withCredentials: true,
            withXSRFToken: true,
        }));

        assert.equal(captured[0]?.credentials, 'include');
        assert.equal(new Headers(captured[0]?.headers).get('X-XSRF-TOKEN'), 'abc123');
        assert.equal(new Headers(captured[1]?.headers).has('X-XSRF-TOKEN'), false);
        assert.equal(captured[2]?.credentials, 'omit');
        assert.equal(new Headers(captured[2]?.headers).get('X-XSRF-TOKEN'), 'abc123');
    } finally {
        restoreBrowserGlobal(browserGlobal, previous);
    }
});

void test('browser adapter enforces timeout, abort, progress, and maxContentLength', async () => {
    const { fetchAdapter } = await import(browserAdapterEntry) as typeof BrowserAdapter;
    const browserGlobal = globalThis as MutableBrowserGlobal;
    const previous = snapshotBrowserGlobal(browserGlobal);
    const downloads: number[] = [];
    const uploads: number[] = [];

    try {
        browserGlobal.fetch = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
            const rejectAbort = (): void => {
                reject(init?.signal?.reason instanceof Error ? init.signal.reason : new Error('Request aborted'));
            };
            if (init?.signal?.aborted) {
                rejectAbort();
                return;
            }
            init?.signal?.addEventListener('abort', rejectAbort, { once: true });
        });
        await assert.rejects(Promise.resolve(fetchAdapter(adapterConfig({ timeout: 5 }))), /Response timeout/u);

        const controller = new AbortController();
        controller.abort(new Error('caller aborted'));
        await assert.rejects(Promise.resolve(fetchAdapter(adapterConfig({ signal: controller.signal }))), /caller aborted/u);

        browserGlobal.fetch = (): Promise<Response> => Promise.resolve(new Response('payload', {
            status: 200,
            headers: { 'content-length': '7' },
        }));
        await assert.rejects(Promise.resolve(fetchAdapter(adapterConfig({ maxContentLength: 3 }))), /Response size/u);

        const raw = await fetchAdapter(adapterConfig({
            data: 'hello',
            method: 'POST',
            onDownloadProgress: event => downloads.push(event.loaded),
            onUploadProgress: event => uploads.push(event.loaded),
            responseType: 'text',
        }));

        assert.equal(raw.data, 'payload');
        assert.deepEqual(uploads, [5]);
        assert.deepEqual(downloads, [0, 7]);
    } finally {
        restoreBrowserGlobal(browserGlobal, previous);
    }
});

void test('package browser condition resolves browser client in Node condition smoke', () => {
    const result = spawnSync(process.execPath, [
        '--conditions=browser',
        '--input-type=module',
        '--eval',
        "import { NeutrxClient } from 'neutrx'; const client = new NeutrxClient(); try { client.pinCertificate('api.example.com', 'a'.repeat(64)); throw new Error('node entry selected'); } catch (error) { if (!String(error.message).includes('Node-only')) throw error; }",
    ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
});

type MutableBrowserGlobal = typeof globalThis & {
    fetch: typeof fetch;
    window?: unknown;
    document?: { cookie: string };
    location?: { href: string; origin: string };
};

type BrowserGlobalSnapshot = {
    readonly fetch: typeof fetch;
    readonly window?: unknown;
    readonly document?: { cookie: string };
    readonly location?: { href: string; origin: string };
};

function snapshotBrowserGlobal(browserGlobal: MutableBrowserGlobal): BrowserGlobalSnapshot {
    return {
        fetch: browserGlobal.fetch,
        ...(browserGlobal.window !== undefined ? { window: browserGlobal.window } : {}),
        ...(browserGlobal.document !== undefined ? { document: browserGlobal.document } : {}),
        ...(browserGlobal.location !== undefined ? { location: browserGlobal.location } : {}),
    };
}

function restoreBrowserGlobal(browserGlobal: MutableBrowserGlobal, snapshot: BrowserGlobalSnapshot): void {
    browserGlobal.fetch = snapshot.fetch;
    restoreOptional(browserGlobal, 'window', snapshot);
    restoreOptional(browserGlobal, 'document', snapshot);
    restoreOptional(browserGlobal, 'location', snapshot);
}

function restoreOptional<TKey extends 'window' | 'document' | 'location'>(
    browserGlobal: MutableBrowserGlobal,
    key: TKey,
    snapshot: BrowserGlobalSnapshot
): void {
    if (key in snapshot) {
        browserGlobal[key] = snapshot[key] as MutableBrowserGlobal[TKey];
        return;
    }
    delete browserGlobal[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function adapterConfig(overrides: Partial<InternalRequestConfig> = {}): InternalRequestConfig {
    return {
        url: 'https://app.example/api',
        method: 'GET',
        headers: {},
        timeout: 5000,
        connectTimeout: 5000,
        maxRedirects: 0,
        maxContentLength: 1024,
        maxBodyLength: 1024,
        responseType: 'json',
        responseEncoding: 'utf8',
        validateStatus: status => status >= 200 && status < 300,
        throwHttpErrors: true,
        decompress: false,
        followRedirects: true,
        requestId: 'browser-test',
        startTime: Date.now(),
        hops: 0,
        xsrfCookieName: 'XSRF-TOKEN',
        xsrfHeaderName: 'X-XSRF-TOKEN',
        ...overrides,
    };
}
