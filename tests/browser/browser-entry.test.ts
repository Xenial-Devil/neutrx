import assert from 'node:assert/strict';
import test from 'node:test';
import type { FetchCredentials } from '../../src/browser.js';
import type * as BrowserEntry from '../../src/browser.js';

const browserEntry = '../../../dist/esm/browser.js';

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
