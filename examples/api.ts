import neutrx, {
    GraphQLPlugin,
    MockPlugin,
    NeutrxHeaders,
    OAuth2Plugin,
} from '../src/index.js';

const baseHeaders = new NeutrxHeaders({
    Accept: 'application/json',
}).setContentType('application/json');

const exampleProxyHost = process.env.EXAMPLE_PROXY_HOST;
const optionalProxyConfig = exampleProxyHost === undefined
    ? {}
    : {
        proxy: {
            protocol: 'http' as const,
            host: exampleProxyHost,
            port: Number.parseInt(process.env.EXAMPLE_PROXY_PORT ?? '8080', 10),
            ...(process.env.EXAMPLE_PROXY_AUTH ? { auth: process.env.EXAMPLE_PROXY_AUTH } : {}),
        },
    };

const api = neutrx.create({
    baseURL: 'https://api.example.com',
    timeout: 15_000,
    headers: baseHeaders.toJSON(),
    formSerializer: {
        dots: true,
        indexes: false,
        metaTokens: true,
        maxDepth: 8,
    },
    instrumentation: {
        openTelemetry: true,
        tracerName: 'neutrx-example',
        propagateTraceHeaders: true,
        recordRequestBodySize: true,
        recordResponseBodySize: true,
    },
    ...optionalProxyConfig,
    security: {
        profile: 'balanced',
        enforceHTTPS: true,
        enableSSRFProtection: true,
        blockPrivateIPs: true,
        blockMetadataIPs: true,
        reResolveOnRedirect: true,
        blockRedirectToPrivateIP: true,
        allowedHosts: ['api.example.com', 'auth.example.com'],
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
