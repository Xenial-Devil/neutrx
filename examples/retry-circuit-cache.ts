import neutrx from '../src/index.js';

export const catalogApi = neutrx.create({
    baseURL: 'https://catalog.example.com',
    timeout: 8_000,
    security: { profile: 'standard' },
    resilience: {
        enableRetry: true,
        maxRetries: 3,
        retryDelay: 250,
        maxRetryDelay: 5_000,
        retryMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
        enableCircuitBreaker: true,
        failureThreshold: 5,
        successThreshold: 2,
        circuitTimeout: 30_000,
        enableBulkhead: true,
        maxConcurrent: 20,
    },
    performance: {
        enableCaching: true,
        cacheTTL: 300_000,
        respectCacheHeaders: true,
    },
});

export async function listProducts(): Promise<unknown> {
    const response = await catalogApi.get('/products');
    console.log(catalogApi.getCacheStats(), catalogApi.getCircuitStatus());
    return response.data;
}
