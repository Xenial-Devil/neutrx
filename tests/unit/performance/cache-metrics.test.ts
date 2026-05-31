import assert from 'node:assert/strict';
import test from 'node:test';
import type CacheEngine from '../../../src/performance/CacheEngine.js';
import type MetricsCollector from '../../../src/monitoring/MetricsCollector.js';
import type { CacheRecord, CacheStore, InternalRequestConfig, NeutrxResponse } from '../../../src/types.js';

const cacheEntry = '../../../../dist/performance/CacheEngine.mjs';
const metricsEntry = '../../../../dist/monitoring/MetricsCollector.mjs';

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
    const cache = new Cache({ cacheTTL: 1000, cacheStrategy: 'swr', revalidateAfter: 10, cacheStaleMax: 1000 });
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

void test('CacheEngine supports max-age and network-first strategies', async () => {
    const { default: Cache } = await import(cacheEntry) as { readonly default: typeof CacheEngine };
    const maxAge = new Cache({ cacheTTL: 10, cacheStrategy: 'max-age' });
    const maxAgeConfig = requestConfig('https://api.example.com/max-age');
    maxAge.set(maxAgeConfig, responseFor(maxAgeConfig, { ok: true }));
    await sleep(20);
    assert.equal(maxAge.getWithState(maxAgeConfig), null);
    maxAge.destroy();

    const networkFirst = new Cache({ cacheTTL: 1000, cacheStrategy: 'network-first', revalidateAfter: 10 });
    const networkFirstConfig = requestConfig('https://api.example.com/network-first');
    networkFirst.set(networkFirstConfig, responseFor(networkFirstConfig, { fallback: true }));
    await sleep(20);
    const fallback = networkFirst.getNetworkFallback(networkFirstConfig);
    assert.equal(fallback?.cached, true);
    assert.equal(fallback?.stale, true);
    assert.equal(fallback?.headers['x-cache'], 'STALE');
    networkFirst.destroy();
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

void test('CacheEngine covers bypasses, eviction, clear, reset, and header edge cases', async () => {
    const { default: Cache } = await import(cacheEntry) as { readonly default: typeof CacheEngine };

    const disabled = new Cache({ enableCaching: false });
    const disabledConfig = requestConfig('https://api.example.com/disabled');
    disabled.set(disabledConfig, responseFor(disabledConfig, { ok: true }));
    assert.equal(disabled.get(disabledConfig), null);
    assert.equal(disabled.getStaleIfError(disabledConfig), null);
    disabled.destroy();

    const nonCacheable = new Cache({ cacheTTL: 1000 });
    const noStore = requestConfig('https://api.example.com/no-store');
    nonCacheable.set(noStore, responseFor(noStore, { ok: false }, 500));
    nonCacheable.set(noStore, {
        ...responseFor(noStore, { ok: false }),
        headers: { 'cache-control': ['private', 'no-cache'] },
    });
    assert.equal(nonCacheable.getStats().sets, 0);
    nonCacheable.destroy();

    const evicting = new Cache({ cacheTTL: 1000, cacheMaxSize: 1 });
    const first = requestConfig('https://api.example.com/first');
    const second = requestConfig('https://api.example.com/second');
    evicting.set(first, responseFor(first, { first: true }));
    evicting.set(second, responseFor(second, { second: true }));
    assert.equal(evicting.get(first), null);
    assert.equal(evicting.get(second)?.cached, true);
    assert.equal(evicting.getStats().evictions, 1);
    evicting.destroy();

    const filteredStore = new TestCacheStore();
    const filtered = new Cache({ cacheTTL: 1000, cacheAdapter: filteredStore });
    const alpha = requestConfig('https://api.example.com/alpha');
    const beta = requestConfig('https://api.example.com/beta');
    filtered.set(alpha, responseFor(alpha, { alpha: true }));
    filtered.set(beta, responseFor(beta, { beta: true }));
    const alphaKey = [...filteredStore.entries.keys()][0] ?? '';
    filtered.clear(alphaKey);
    assert.equal(filtered.get(alpha), null);
    assert.equal(filtered.get(beta)?.cached, true);
    assert.equal(filtered.invalidate(/beta/u), 1);
    assert.equal(filtered.get(beta), null);
    filtered.set(beta, responseFor(beta, { beta: true }));
    assert.equal(filtered.deleteByUrl(beta.url), true);
    assert.equal(filtered.get(beta), null);
    filtered.reset();
    assert.equal(filtered.getStats().hits, 0);
    filtered.clear();
    assert.equal(filtered.getStats().size, 0);
    filtered.destroy();

    const ttl = new Cache({ cacheTTL: 1 });
    const expiring = requestConfig('https://api.example.com/expiring');
    ttl.set(expiring, responseFor(expiring, { stale: false }));
    await sleep(10);
    assert.equal(ttl.getWithState(expiring), null);
    ttl.destroy();

    const headers = new Cache({ cacheTTL: 1000 });
    const future = requestConfig('https://api.example.com/future');
    headers.set(future, {
        ...responseFor(future, { ok: true }),
        headers: { expires: new Date(Date.now() + 60_000).toUTCString() },
    });
    assert.equal(headers.get(future)?.cached, true);
    assert.deepEqual(headers.revalidationHeaders(requestConfig('https://api.example.com/missing')), {});
    headers.refresh(requestConfig('https://api.example.com/missing'), { etag: '"none"' });
    headers.finishRevalidating(requestConfig('https://api.example.com/missing'));
    headers.destroy();

    const circular = new Cache({ cacheTTL: 1000 });
    const circularConfig = requestConfig('https://api.example.com/circular');
    const value: Record<string, unknown> = {};
    value.self = value;
    circular.set(circularConfig, responseFor(circularConfig, value));
    assert.equal(circular.get(circularConfig)?.cached, true);
    circular.destroy();
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
    metrics.recordDeduplicationHit('https://api.example.com/users');

    const snapshot = metrics.getAll();
    assert.equal(snapshot.requests.total, 3);
    assert.equal(snapshot.requests.active, 0);
    assert.equal(snapshot.requests.retried, 1);
    assert.equal(snapshot.requests.deduplicated, 1);
    assert.equal(snapshot.summary.deduplicationRate, '33.33%');
    assert.match(metrics.toPrometheus(), /neutrx_requests_total\{status="success"\} 1/u);
    assert.match(metrics.toPrometheus(), /neutrx_deduplication_hits_total 1/u);
    assert.match(metrics.toPrometheus(), /neutrx_active_requests 0/u);
    metrics.destroy();
});

function requestConfig(url: string): InternalRequestConfig {
    return {
        url,
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
        validateStatus: status => status < 400,
        throwHttpErrors: true,
        decompress: true,
        transitional: { clarifyTimeoutError: false },
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

function responseFor(config: InternalRequestConfig, data: NeutrxResponse['data'], status = 200): NeutrxResponse {
    return {
        status,
        statusText: status < 400 ? 'OK' : 'Error',
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
