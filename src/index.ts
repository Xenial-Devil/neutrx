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
    NeutrxRequestSizeError,
    NeutrxResponseSizeError,
    NeutrxResponseTimeoutError,
    NeutrxSSRFError,
    NeutrxSecurityError,
    NeutrxServerError,
    NeutrxTimeoutError,
    isNeutrxError,
} from './core/NeutrxError.js';
export { default as NeutrxClient } from './core/NeutrxClient.js';
export { default as Neutrx } from './core/Neutrx.js';
export { fetchAdapter } from './adapters/fetch.js';
export { http2Adapter } from './adapters/http2.js';
export { NeutrxHeaders } from './core/headers.js';
export { OpenTelemetryInstrumentation } from './monitoring/OpenTelemetryInstrumentation.js';
export type { NeutrxInstance, NeutrxStatic } from './core/Neutrx.js';
export type { AxiosInterceptorManager, AxiosInterceptors, RequestInterceptorOptions } from './interceptors/InterceptorChain.js';
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
    FetchCredentials,
    FetchImplementation,
    FormSerializerOptions,
    GraphQLResult,
    Headers,
    Http2Options,
    HttpMethod,
    InstrumentationConfig,
    JsonObject,
    JsonValue,
    LookupFunction,
    MockController,
    MockResponse,
    NeutrxResponse,
    OAuth2Config,
    PaginationOptions,
    PaginationPage,
    ParsedResponseData,
    PerformanceConfig,
    ProgressEvent,
    ProxyConfig,
    QueryParams,
    RequestBody,
    RequestConfig,
    RequestAdapter,
    RequestAdapterConfig,
    RequestAdapterName,
    RedirectContext,
    ResilienceConfig,
    ResponseType,
    SecurityConfig,
    SseHandle,
    TransformRequest,
    TransformResponse,
} from './types.js';

export const VERSION = '1.1.0';

export default Neutrx;
