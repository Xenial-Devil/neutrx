import assert from 'node:assert/strict';
import test from 'node:test';
import type CacheEngine from '../../../src/performance/CacheEngine.js';
import type MetricsCollector from '../../../src/monitoring/MetricsCollector.js';
import type { CacheRecord, CacheStore, InternalRequestConfig, NeutrxResponse } from '../../../src/types.js';

const cacheEntry = '../../../../dist/esm/performance/CacheEngine.js';
const metricsEntry = '../../../../dist/esm/monitoring/MetricsCollector.js';

void test('CacheEngine stores cacheable responses and returns HIT metadata', async () => {
    const { default: Cache } = await import(cacheEntry) as { readonly default: typeof CacheEngine };
    const cache = new Cache({ cacheTTL: 1000 });
    const config = requestConfig('https://api.example.com/users');
    const response = responseFor(config, { ok: true });

    cache.set(config, response);
    const hit = cache.get(config);

    assert.equal(hit?.cached, true);
    assert.equal(hit?.headers['x-cache'], 'HIT');
    assert.equal(cache.getStats().hits, 1);
    cache.destroy();
});

void test('CacheEngine can return stale entries for stale-while-revalidate', async () => {
    const { default: Cache } = await import(cacheEntry) as { readonly default: typeof CacheEngine };
    const cache = new Cache({ cacheTTL: 10, cacheStrategy: 'stale-while-revalidate', cacheStaleMax: 1000 });
    const config = requestConfig('https://api.example.com/stale');
    const response = responseFor(config, { stale: true });

    cache.set(config, response);
    await sleep(20);
    const hit = cache.getWithState(config);

    assert.equal(hit?.state, 'stale');
    assert.equal(hit?.response.stale, true);
    assert.equal(hit?.response.headers['x-cache'], 'STALE');
    assert.equal(cache.markRevalidating(config), true);
    assert.equal(cache.markRevalidating(config), false);
    cache.finishRevalidating(config);
    assert.equal(cache.markRevalidating(config), true);
    cache.destroy();
});

void test('CacheEngine supports conditional revalidation and stale-if-error windows', async () => {
    const { default: Cache } = await import(cacheEntry) as { readonly default: typeof CacheEngine };
    const cache = new Cache({ cacheTTL: 10 });
    const config = requestConfig('https://api.example.com/revalidate');
    const baseResponse = responseFor(config, { ok: true });
    const response = {
        ...baseResponse,
        headers: {
            ...baseResponse.headers,
            etag: '"abc"',
            'last-modified': 'Tue, 19 May 2026 00:00:00 GMT',
            'cache-control': 'max-age=0, stale-if-error=60',
        },
    };

    cache.set(config, response);
    assert.deepEqual(cache.revalidationHeaders(config), {
        'If-None-Match': '"abc"',
        'If-Modified-Since': 'Tue, 19 May 2026 00:00:00 GMT',
    });

    await sleep(20);
    const stale = cache.getStaleIfError(config);
    assert.equal(stale?.stale, true);
    assert.equal(stale?.headers['x-cache'], 'STALE-IF-ERROR');

    cache.refresh(config, { 'cache-control': 'max-age=60', etag: '"def"' });
    assert.equal(cache.getWithState(config)?.response.headers.etag, '"def"');
    cache.destroy();
});

void test('CacheEngine uses custom cache adapter locks for revalidation', async () => {
    const { default: Cache } = await import(cacheEntry) as { readonly default: typeof CacheEngine };
    const store = new TestCacheStore();
    const cache = new Cache({ cacheTTL: 1000, cacheAdapter: store });
    const config = requestConfig('https://api.example.com/adapter');

    cache.set(config, responseFor(config, { ok: true }));

    assert.equal(cache.get(config)?.cached, true);
    assert.equal(cache.markRevalidating(config), true);
    assert.equal(cache.markRevalidating(config), false);
    cache.finishRevalidating(config);
    assert.equal(cache.markRevalidating(config), true);
    assert.equal(store.lockCount, 2);
    cache.destroy();
});

void test('MetricsCollector records success, errors, cache hits, retries, and prometheus output', async () => {
    const { default: Metrics } = await import(metricsEntry) as { readonly default: typeof MetricsCollector };
    const metrics = new Metrics();
    metrics.recordStart();
    assert.equal(metrics.getAll().requests.active, 1);
    metrics.recordEnd();
    metrics.recordSuccess('https://api.example.com/users', 20, 200);
    metrics.recordError('https://api.example.com/users', Object.assign(new Error('boom'), { code: 'EBOOM' }));
    metrics.recordCacheHit('https://api.example.com/users');
    metrics.recordRetry('https://api.example.com/users', 1);

    const snapshot = metrics.getAll();
    assert.equal(snapshot.requests.total, 3);
    assert.equal(snapshot.requests.active, 0);
    assert.equal(snapshot.requests.retried, 1);
    assert.match(metrics.toPrometheus(), /neutrx_requests_total\{status="success"\} 1/u);
    assert.match(metrics.toPrometheus(), /neutrx_active_requests 0/u);
    metrics.destroy();
});

function requestConfig(url: string): InternalRequestConfig {
    return {
        url,
        method: 'GET',
        headers: {},
        timeout: 1000,
        connectTimeout: 1000,
        maxRedirects: 0,
        maxContentLength: 1024,
        maxBodyLength: 1024,
        responseType: 'json',
        responseEncoding: 'utf8',
        validateStatus: status => status < 400,
        throwHttpErrors: true,
        decompress: true,
        followRedirects: true,
        requestId: 'cache-test',
        startTime: Date.now(),
        hops: 0,
    };
}

class TestCacheStore implements CacheStore {
    readonly entries = new Map<string, CacheRecord>();
    readonly locks = new Set<string>();
    lockCount = 0;

    get(key: string): CacheRecord | undefined {
        return this.entries.get(key);
    }

    set(key: string, value: CacheRecord): void {
        this.entries.set(key, value);
    }

    delete(key: string): void {
        this.entries.delete(key);
        this.locks.delete(key);
    }

    clear(): void {
        this.entries.clear();
        this.locks.clear();
    }

    keys(): Iterable<string> {
        return this.entries.keys();
    }

    lock(key: string): boolean {
        if (this.locks.has(key)) return false;
        this.locks.add(key);
        this.lockCount += 1;
        return true;
    }

    unlock(key: string): void {
        this.locks.delete(key);
    }
}

function responseFor(config: InternalRequestConfig, data: NeutrxResponse['data']): NeutrxResponse {
    return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data,
        config,
        timing: { duration: 1 },
        requestId: config.requestId,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
