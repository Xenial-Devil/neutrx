import Neutrx, { GraphQLPlugin, OAuth2Plugin } from '../dist/index.mjs';
import { runSuite } from './runner.js';
import { makeRawAdapter, makeRoutingFetch } from './fixtures/payloads.js';

const rawAdapter = makeRawAdapter({ ok: true });
const requests25 = Array.from({ length: 25 }, (_, index) => ({ method: 'GET', url: `/items/${index}`, adapter: rawAdapter }));
const requests5 = Array.from({ length: 5 }, (_, index) => ({ method: 'GET', url: `/region/${index}`, adapter: rawAdapter }));

const client = Neutrx.create({
    baseURL: 'https://api.example.com',
    resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    performance: { enableCaching: false },
});

const paginatedClient = client.create({
    adapter: async config => {
        const url = new URL(config.url);
        const page = Number(url.searchParams.get('page') ?? '1');
        const data = { data: Array.from({ length: 20 }, (_, index) => page * 100 + index), hasMore: page < 10 };
        return {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify(data)),
            config,
        };
    },
});

const pluginClient = Neutrx.create({
    baseURL: 'https://api.example.com',
    adapter: 'fetch',
    fetch: makeRoutingFetch([
        { match: '/token', data: { access_token: 'token', expires_in: 3600 } },
        { match: '/graphql', data: { data: { viewer: { id: '1', name: 'Ada' } } } },
        { match: '/secure', data: { ok: true } },
    ]),
    resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    performance: { enableCaching: false },
});
pluginClient.use(GraphQLPlugin).use(OAuth2Plugin);
pluginClient.configureOAuth2?.({ tokenURL: 'https://api.example.com/token' });
await pluginClient.get('/secure');

try {
    await runSuite({
        name: 'Async Workflow Benchmark',
        outputName: 'async-benchmark',
        notes: [
            'Benchmarks public concurrency helpers, pagination, GraphQL plugin, and cached OAuth2 hook.',
            'Uses custom adapters/fetch to avoid external network variability.',
        ],
        benchmarks: [
            {
                name: 'concurrent 25 GET limit 5',
                category: 'concurrent',
                inputSize: '25 req',
                options: { minIterations: 40, minTimeMs: 900 },
                fn() {
                    return client.concurrent(requests25, { limit: 5 });
                },
            },
            {
                name: 'sequential 25 GET',
                category: 'async',
                inputSize: '25 req',
                options: { minIterations: 30, minTimeMs: 900 },
                fn() {
                    return client.sequential(requests25);
                },
            },
            {
                name: 'race 5 GET',
                category: 'async',
                inputSize: '5 req',
                options: { minIterations: 80 },
                fn() {
                    return client.race(requests5);
                },
            },
            {
                name: 'hedged 5 GET delay 0',
                category: 'async',
                inputSize: '5 req',
                options: { minIterations: 80 },
                fn() {
                    return client.hedged(requests5, { delay: 0 });
                },
            },
            {
                name: 'paginate 10 pages',
                category: 'pagination',
                inputSize: '10 pages',
                options: { minIterations: 30, minTimeMs: 900 },
                async fn() {
                    for await (const page of paginatedClient.paginate('/pages', { pageSize: 20, maxPages: 10 })) {
                        if (!page.data) throw new Error('missing page data');
                    }
                },
            },
            {
                name: 'GraphQLPlugin gql request',
                category: 'plugin',
                inputSize: 'small',
                options: { minIterations: 80 },
                fn() {
                    return pluginClient.gql?.('/graphql', '{ viewer { id name } }');
                },
            },
            {
                name: 'OAuth2Plugin cached token GET',
                category: 'plugin',
                inputSize: 'small',
                options: { minIterations: 80 },
                fn() {
                    return pluginClient.get('/secure');
                },
            },
        ],
    });
} finally {
    client.destroy();
    paginatedClient.destroy();
    pluginClient.destroy();
}
