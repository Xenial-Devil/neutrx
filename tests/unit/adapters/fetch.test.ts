import assert from 'node:assert/strict';
import test from 'node:test';
import type * as FetchModule from '../../../src/adapters/fetch.js';

const fetchEntry = '../../../../dist/esm/adapters/fetch.js';

type BrowserGlobal = typeof globalThis & {
    window?: unknown;
    document?: { cookie: string };
    location?: { href: string; origin: string };
};

void test('fetch adapter honors credentials, custom fetch, timeout signal, and XSRF', async () => {
    const { fetchAdapter } = await import(fetchEntry) as typeof FetchModule;
    const browserGlobal = globalThis as BrowserGlobal;
    browserGlobal.window = browserGlobal;
    browserGlobal.document = { cookie: 'XSRF-TOKEN=abc123' };
    browserGlobal.location = { href: 'https://app.example/current', origin: 'https://app.example' };

    let captured: RequestInit | undefined;
    const customFetch: typeof fetch = (_url, init) => {
        captured = init;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json', 'content-length': '11' },
        }));
    };

    const raw = await fetchAdapter({
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
        validateStatus: status => status < 500,
        decompress: false,
        followRedirects: true,
        requestId: 'test',
        startTime: Date.now(),
        hops: 0,
        fetch: customFetch,
        withCredentials: true,
        xsrfCookieName: 'XSRF-TOKEN',
        xsrfHeaderName: 'X-XSRF-TOKEN',
    });

    assert.equal(raw.status, 200);
    assert.ok(raw.request instanceof Request);
    assert.equal(captured?.credentials, 'include');
    assert.equal(new Headers(captured?.headers).get('X-XSRF-TOKEN'), 'abc123');
});
