import assert from 'node:assert/strict';
import test from 'node:test';
import type CacheEngine from '../../../src/performance/CacheEngine.js';
import type MetricsCollector from '../../../src/monitoring/MetricsCollector.js';
import type { InternalRequestConfig, NeutrxResponse } from '../../../src/types.js';

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

void test('MetricsCollector records success, errors, cache hits, retries, and prometheus output', async () => {
    const { default: Metrics } = await import(metricsEntry) as { readonly default: typeof MetricsCollector };
    const metrics = new Metrics();
    metrics.recordSuccess('https://api.example.com/users', 20, 200);
    metrics.recordError('https://api.example.com/users', Object.assign(new Error('boom'), { code: 'EBOOM' }));
    metrics.recordCacheHit('https://api.example.com/users');
    metrics.recordRetry('https://api.example.com/users', 1);

    const snapshot = metrics.getAll();
    assert.equal(snapshot.requests.total, 3);
    assert.equal(snapshot.requests.retried, 1);
    assert.match(metrics.toPrometheus(), /neutrx_requests_total\{status="success"\} 1/u);
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
        decompress: true,
        followRedirects: true,
        requestId: 'cache-test',
        startTime: Date.now(),
        hops: 0,
    };
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
