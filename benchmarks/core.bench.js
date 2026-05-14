import Neutrx, { MockPlugin, NeutrxHeaders } from '../dist/esm/index.js';
import { runSuite } from './runner.js';
import { makeHeaders, makeJsonPayload, makeParams, makeRawAdapter } from './fixtures/payloads.js';

const smallParams = makeParams(5);
const mediumParams = makeParams(100);
const manyHeaders = makeHeaders(100);
const rawAdapter = makeRawAdapter({ ok: true, users: [{ id: 1, name: 'Ada' }] });

const baseClient = Neutrx.create({
    baseURL: 'https://api.example.com/v1',
    headers: { Accept: 'application/json' },
    resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    performance: { enableCaching: false },
});

const transformedClient = baseClient.create({
    transformRequest: data => data,
    transformResponse: data => data,
});
transformedClient.useRequest(config => ({ ...config, headers: { ...config.headers, 'X-Bench': '1' } }), undefined, { synchronous: true });
transformedClient.useResponse(response => response);

const mockClient = baseClient.create();
mockClient.use(MockPlugin);
mockClient.mock?.enable().register('/health', { status: 200, data: { ok: true } });

const cacheClient = Neutrx.create({
    baseURL: 'https://api.example.com/v1',
    resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    performance: { enableCaching: true, cacheTTL: 60_000 },
});
await cacheClient.get('/cached', { adapter: rawAdapter });

try {
    await runSuite({
        name: 'Core Public API Benchmark',
        outputName: 'core-benchmark',
        notes: [
            'Benchmarks public client creation, URL building, headers, mock plugin, cache hit, custom adapter request pipeline.',
            'Network is bypassed except adapter parsing, so results isolate module overhead.',
        ],
        benchmarks: [
            {
                name: 'create README-style client',
                category: 'client',
                inputSize: 'small',
                options: { operationsPerIteration: 20, maxIterations: 1000 },
                fn() {
                    for (let index = 0; index < 20; index += 1) {
                        const client = Neutrx.create({
                            baseURL: 'https://api.example.com',
                            timeout: 15_000,
                            connectTimeout: 5_000,
                            headers: { Accept: 'application/json' },
                            formSerializer: { dots: true, indexes: false, maxDepth: 8 },
                            security: {
                                profile: 'balanced',
                                enforceHTTPS: true,
                                enableSSRFProtection: true,
                                blockPrivateIPs: true,
                                blockMetadataIPs: true,
                            },
                            resilience: { enableRetry: true, maxRetries: 3, enableCircuitBreaker: true, enableBulkhead: true },
                            performance: { enableCaching: true, cacheTTL: 300_000 },
                        });
                        client.destroy();
                    }
                },
            },
            {
                name: 'getUri with small params',
                category: 'url',
                inputSize: '5 params',
                options: { operationsPerIteration: 1000 },
                fn() {
                    for (let index = 0; index < 1000; index += 1) baseClient.getUri({ url: '/users', params: smallParams });
                },
            },
            {
                name: 'getUri with medium params',
                category: 'url',
                inputSize: '100 params',
                options: { operationsPerIteration: 100 },
                fn() {
                    for (let index = 0; index < 100; index += 1) baseClient.getUri({ url: '/users', params: mediumParams });
                },
            },
            {
                name: 'NeutrxHeaders concat normalize redact',
                category: 'headers',
                inputSize: '100 headers',
                options: { operationsPerIteration: 100 },
                fn() {
                    for (let index = 0; index < 100; index += 1) {
                        NeutrxHeaders
                            .concat(manyHeaders, { Authorization: 'Bearer secret', Cookie: 'sid=secret' })
                            .set('X-Request-ID', `bench-${index}`)
                            .redactSensitive();
                    }
                },
            },
            {
                name: 'GET through custom adapter',
                category: 'request',
                inputSize: 'small',
                options: { minIterations: 100 },
                fn() {
                    return baseClient.get('/users', { adapter: rawAdapter });
                },
            },
            {
                name: 'POST transforms and interceptors',
                category: 'request',
                inputSize: 'small json',
                options: { minIterations: 100 },
                fn() {
                    return transformedClient.post('/users', makeJsonPayload(3), { adapter: rawAdapter });
                },
            },
            {
                name: 'MockPlugin matched GET',
                category: 'plugin',
                inputSize: 'small',
                options: { minIterations: 100 },
                fn() {
                    return mockClient.get('/health');
                },
            },
            {
                name: 'GET cache hit',
                category: 'cache',
                inputSize: 'small',
                options: { minIterations: 100 },
                fn() {
                    return cacheClient.get('/cached', { adapter: rawAdapter });
                },
            },
        ],
    });
} finally {
    baseClient.destroy();
    transformedClient.destroy();
    mockClient.destroy();
    cacheClient.destroy();
}
