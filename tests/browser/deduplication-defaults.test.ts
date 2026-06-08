import assert from 'node:assert/strict';
import test from 'node:test';
import type * as BrowserEntry from '../../src/browser.js';

const browserEntry = '../../../dist/browser.mjs';

type MutableGlobal = typeof globalThis & {
    fetch: typeof fetch;
};

void test('browser deduplication defaults to safe methods and can be disabled', async () => {
    const originalFetch = globalThis.fetch;
    const globalWithFetch = globalThis as MutableGlobal;
    let calls = 0;

    globalWithFetch.fetch = async (): Promise<Response> => {
        calls += 1;
        await delay(20);
        return new Response(JSON.stringify({ calls }), {
            headers: { 'content-type': 'application/json' },
        });
    };

    try {
        const mod = await import(browserEntry) as typeof BrowserEntry;
        const defaults = {
            baseURL: 'https://dedupe.example',
            performance: { enableCaching: false },
            resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
        };
        const api = mod.default.create(defaults);

        const [, joinedGet] = await Promise.all([
            api.get('/safe'),
            api.get('/safe'),
        ]);
        assert.equal(calls, 1);
        assert.equal(joinedGet.deduplicated, true);

        await Promise.all([
            api.post('/unsafe', { value: 1 }),
            api.post('/unsafe', { value: 1 }),
        ]);
        assert.equal(calls, 3);

        const disabled = mod.default.create({
            ...defaults,
            performance: { enableCaching: false, deduplicateRequests: false },
        });
        await Promise.all([
            disabled.get('/disabled'),
            disabled.get('/disabled'),
        ]);
        assert.equal(calls, 5);

        api.destroy();
        disabled.destroy();
    } finally {
        globalWithFetch.fetch = originalFetch;
    }
});

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
