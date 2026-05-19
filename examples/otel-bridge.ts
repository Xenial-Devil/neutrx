import neutrx from '../src/index.js';

const api = neutrx.create({
    baseURL: 'https://api.example.com',
    timeout: 10_000,
    security: { profile: 'standard' },
    instrumentation: {
        openTelemetry: true,
        tracerName: 'example-service-http',
        propagateTraceHeaders: true,
    },
});

api.on('request:success', event => {
    const payload = event as { readonly status?: unknown; readonly duration?: unknown };
    console.log('http success', payload.status, payload.duration);
});

api.on('request:error', event => {
    const payload = event as { readonly error?: { readonly code?: unknown } };
    console.error('http error', payload.error?.code);
});

export async function fetchHealth(): Promise<number> {
    const response = await api.get('/health');
    console.log(api.getMetrics());
    return response.status;
}
