import Neutrx from './core/Neutrx.js';

export {
    NeutrxBulkheadError,
    NeutrxCertPinError,
    NeutrxCircuitBreakerError,
    NeutrxClientError,
    NeutrxConnectTimeoutError,
    NeutrxDNSError,
    NeutrxError,
    NeutrxErrorFactory,
    NeutrxHTTPError,
    NeutrxInjectionError,
    NeutrxMaxRetriesError,
    NeutrxNetworkError,
    NeutrxPrototypePollutionError,
    NeutrxRateLimitError,
    NeutrxResponseSizeError,
    NeutrxResponseTimeoutError,
    NeutrxSSRFError,
    NeutrxSecurityError,
    NeutrxServerError,
    NeutrxTimeoutError,
} from './core/NeutrxError.js';
export { default as NeutrxClient } from './core/NeutrxClient.js';
export { default as Neutrx } from './core/Neutrx.js';
export type { NeutrxInstance, NeutrxStatic } from './core/Neutrx.js';
export { PluginManager, OAuth2Plugin, GraphQLPlugin, MockPlugin, type NeutrxPlugin } from './plugins/PluginManager.js';
export { STRATEGY } from './resilience/RetryEngine.js';
export { ALGORITHMS } from './security/RateLimiter.js';
export type {
    AuthConfig,
    BulkheadStats,
    CacheStats,
    CircuitStatus,
    ClientConfig,
    ConcurrentOptions,
    ConcurrentResult,
    GraphQLResult,
    Headers,
    HttpMethod,
    JsonObject,
    JsonValue,
    MockController,
    MockResponse,
    NeutrxResponse,
    OAuth2Config,
    PaginationOptions,
    PaginationPage,
    ParsedResponseData,
    PerformanceConfig,
    QueryParams,
    RequestBody,
    RequestConfig,
    ResilienceConfig,
    ResponseType,
    SecurityConfig,
    SseHandle,
} from './types.js';

export const VERSION = '1.0.0';

export default Neutrx;
