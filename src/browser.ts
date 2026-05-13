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
    NeutrxRequestSizeError,
    NeutrxResponseSizeError,
    NeutrxResponseTimeoutError,
    NeutrxSSRFError,
    NeutrxSecurityError,
    NeutrxServerError,
    NeutrxTimeoutError,
    isNeutrxError,
} from './core/NeutrxError.js';
export { default as BrowserClient, default as NeutrxClient } from './core/BrowserClient.js';
export { PluginManager, OAuth2Plugin, GraphQLPlugin, MockPlugin, type NeutrxPlugin } from './plugins/PluginManager.js';
export { STRATEGY } from './resilience/RetryEngine.js';
export type { NeutrxInstance, NeutrxStatic } from './core/BrowserNeutrx.js';
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
    ProgressEvent,
    QueryParams,
    RequestBody,
    RequestConfig,
    RequestAdapter,
    RequestAdapterConfig,
    RequestAdapterName,
    ResilienceConfig,
    ResponseType,
    SecurityConfig,
    TransformRequest,
    TransformResponse,
} from './types.js';

import Neutrx from './core/BrowserNeutrx.js';

export const VERSION = '1.0.0';

export default Neutrx;
