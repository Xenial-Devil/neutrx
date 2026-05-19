import neutrx from 'neutrx';

export const billingApi = neutrx.create({
    baseURL: 'https://billing.internal.example',
    timeout: 8_000,
    connectTimeout: 2_000,
    auth: {
        username: process.env.BILLING_CLIENT_ID ?? '',
        password: process.env.BILLING_CLIENT_SECRET ?? '',
    },
    security: {
        profile: 'standard',
        allowedHosts: ['billing.internal.example'],
    },
    egressPolicy: {
        mode: 'internal-service',
        allowedHosts: ['billing.internal.example'],
        allowedPorts: [443],
        blockCloudMetadata: true,
    },
    resilience: {
        enableRetry: true,
        maxRetries: 3,
        retryBudget: {
            maxRetries: 100,
            windowMs: 60_000,
            scope: 'origin',
            namespace: 'billing-api',
        },
        enableCircuitBreaker: true,
        enableBulkhead: true,
        maxConcurrent: 20,
    },
    performance: {
        enableCaching: true,
        deduplicateRequests: true,
        cacheStrategy: 'stale-while-revalidate',
        respectCacheHeaders: true,
    },
    instrumentation: {
        openTelemetry: true,
        propagateTraceHeaders: true,
    },
});

export async function createInvoice(customerId: string, amountCents: number): Promise<unknown> {
    const response = await billingApi.post('/invoices', {
        customerId,
        amountCents,
    });
    return response.data;
}

export async function requestToken(): Promise<unknown> {
    const response = await billingApi.postUrlEncoded('/oauth/token', {
        grant_type: 'client_credentials',
        client_id: process.env.BILLING_CLIENT_ID ?? '',
        client_secret: process.env.BILLING_CLIENT_SECRET ?? '',
    });
    return response.data;
}
