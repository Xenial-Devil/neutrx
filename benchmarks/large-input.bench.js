import Neutrx from '../dist/index.mjs';
import { parseResponseData } from '../dist/core/responseParser.mjs';
import { serializeBody } from '../dist/core/bodySerializer.mjs';
import { runSuite } from './runner.js';
import { makeFetch, makeJsonPayload, makeNestedPayload, makeParams, withEchoServer } from './fixtures/payloads.js';

const emptyPayload = {};
const smallPayload = makeJsonPayload(10, 32);
const mediumPayload = makeJsonPayload(500, 64);
const largePayload = makeJsonPayload(2500, 96);
const largePayloadText = JSON.stringify(largePayload);
const memoryBuffer = Buffer.alloc(1024 * 1024, 'a');
const largeParams = makeParams(1000);

const fetchClient = Neutrx.create({
    baseURL: 'https://api.example.com',
    adapter: 'fetch',
    fetch: makeFetch({ ok: true }),
    resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    performance: { enableCaching: false },
});

try {
    await withEchoServer(async baseURL => {
        const httpClient = Neutrx.create({
            baseURL,
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
            resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
            performance: { enableCaching: false },
        });

        try {
            await runSuite({
                name: 'Large Input Benchmark',
                outputName: 'large-input-benchmark',
                notes: [
                    'Uses public API for URL building, fetch adapter requests, and in-process HTTP POST serialization.',
                    'Imports core serializer/parser helpers directly to isolate pure data transformation cost without loopback network overhead.',
                ],
                benchmarks: [
                    {
                        name: 'getUri large query params',
                        category: 'url',
                        inputSize: '1000 params',
                        options: { operationsPerIteration: 20, maxIterations: 2000 },
                        fn() {
                            for (let index = 0; index < 20; index += 1) fetchClient.getUri({ url: '/search', params: largeParams });
                        },
                    },
                    {
                        name: 'fetch adapter POST empty object',
                        category: 'request',
                        inputSize: 'empty',
                        options: { minIterations: 100 },
                        fn() {
                            return fetchClient.post('/items', emptyPayload);
                        },
                    },
                    {
                        name: 'fetch adapter POST small JSON',
                        category: 'request',
                        inputSize: '~1 KiB',
                        options: { minIterations: 100 },
                        fn() {
                            return fetchClient.post('/items', smallPayload);
                        },
                    },
                    {
                        name: 'fetch adapter POST medium JSON',
                        category: 'request',
                        inputSize: '~64 KiB',
                        options: { minIterations: 80 },
                        fn() {
                            return fetchClient.post('/items', mediumPayload);
                        },
                    },
                    {
                        name: 'fetch adapter POST large JSON',
                        category: 'request',
                        inputSize: '~512 KiB',
                        options: { minIterations: 30, minTimeMs: 900 },
                        fn() {
                            return fetchClient.post('/items', largePayload);
                        },
                    },
                    {
                        name: 'HTTP adapter POST medium JSON',
                        category: 'network',
                        inputSize: '~64 KiB',
                        options: { minIterations: 30, minTimeMs: 900, maxIterations: 300 },
                        fn() {
                            return httpClient.post('/echo', mediumPayload);
                        },
                    },
                    {
                        name: 'serialize urlencoded medium object',
                        category: 'serializer',
                        inputSize: '500 items',
                        options: { minIterations: 80 },
                        fn() {
                            return serializeBody({
                                data: mediumPayload,
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            });
                        },
                    },
                    {
                        name: 'parse large JSON buffer',
                        category: 'parser',
                        inputSize: '~512 KiB',
                        options: { minIterations: 80 },
                        fn() {
                            parseResponseData(Buffer.from(largePayloadText), 'json', { 'content-type': 'application/json' }, 'utf8');
                        },
                    },
                    {
                        name: 'sanitize nested worst-case POST',
                        category: 'security',
                        inputSize: 'depth 9',
                        options: { minIterations: 60 },
                        fn() {
                            return fetchClient.post('/nested', makeNestedPayload(9));
                        },
                    },
                    {
                        name: 'fetch adapter POST 1 MiB buffer',
                        category: 'memory',
                        inputSize: '1 MiB',
                        options: { minIterations: 30, minTimeMs: 900 },
                        fn() {
                            return fetchClient.post('/upload', memoryBuffer);
                        },
                    },
                ],
            });
        } finally {
            httpClient.destroy();
        }
    });
} finally {
    fetchClient.destroy();
}
