import neutrx, {
    GraphQLPlugin,
    MockPlugin,
    OAuth2Plugin,
} from '../src/index.js';

const api = neutrx.create({
    baseURL: 'https://api.example.com',
    timeout: 15_000,
    security: {
        enforceHTTPS: true,
        enableSSRFProtection: true,
        blockPrivateIPs: true,
        sanitizeInputs: true,
        sanitizeOutputs: true,
        rateLimit: {
            enabled: true,
            maxRequests: 100,
            windowMs: 60_000,
            algorithm: 'sliding_window',
        },
    },
    resilience: {
        enableCircuitBreaker: true,
        failureThreshold: 5,
        enableRetry: true,
        maxRetries: 3,
        retryStrategy: 'exponential',
        retryDelay: 1000,
        enableBulkhead: true,
        maxConcurrent: 20,
    },
    performance: {
        enableCaching: true,
        cacheTTL: 300_000,
    },
});

api.use(GraphQLPlugin).use(OAuth2Plugin).use(MockPlugin);

api.configureOAuth2?.({
    tokenURL: 'https://auth.example.com/token',
    scope: 'read write',
    ...(process.env.CLIENT_ID ? { clientId: process.env.CLIENT_ID } : {}),
    ...(process.env.CLIENT_SECRET ? { clientSecret: process.env.CLIENT_SECRET } : {}),
});

api.setAuth({ bearer: process.env.API_TOKEN ?? 'development-token' });
api.blockDomain('malicious.com');

api.useRequest(config => {
    console.log(`-> ${config.method} ${config.url}`);
    return config;
});

api.useResponse(response => {
    console.log(`<- ${response.status} (${response.timing.duration}ms)`);
    return response;
});

api.on('request:success', payload => {
    console.log('request success', payload);
});

export default api;
