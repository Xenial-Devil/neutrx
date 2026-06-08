import neutrx, {
    LogPlugin,
    createOtelPlugin,
    createTraceContextPlugin,
    toStructuredError,
} from '../src/index.js';

const api = neutrx.create({
    baseURL: 'https://api.example.com',
    timeout: 10_000,
    security: { profile: 'standard' },
});

api.use(LogPlugin);
api.setLogger(console);
api.use(createOtelPlugin({
    tracerName: 'example-service-http',
    propagateTraceHeaders: true,
}));
api.use(createTraceContextPlugin({
    formats: ['w3c', 'b3-multi'],
}));

export async function fetchHealth(): Promise<number> {
    try {
        const response = await api.get('/health');
        console.log(response.traceContext, api.getMetrics());
        return response.status;
    } catch (error) {
        console.error(toStructuredError(error));
        throw error;
    }
}
