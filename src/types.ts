import type { Agent as HttpAgent, ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import type { ClientHttp2Stream } from 'node:http2';
import type { Agent as HttpsAgent } from 'node:https';
import type { Readable } from 'node:stream';
import type { SecureContextOptions } from 'node:tls';
import type { NeutrxHeaders } from './core/headers.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonArray = readonly JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type HeaderValue = string | number | boolean | readonly string[];
export type HeaderRecord = Record<string, HeaderValue | null | undefined>;
export type HeaderTuple = readonly [string, HeaderValue | null | undefined];
export interface HeaderMapLike {
    forEach(callback: (value: string, key: string) => void): void;
}
export type Headers = Record<string, HeaderValue>;
export type HeaderSource = HeaderRecord | NeutrxHeaders | HeaderMapLike | Iterable<HeaderTuple>;
export type InternalHeaders = Headers & NeutrxHeaders;
export type QueryScalar = string | number | boolean;
export type QueryObject = { readonly [key: string]: QueryValue };
export type QueryValue = QueryScalar | readonly (QueryScalar | QueryObject)[] | QueryObject | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ResponseType = 'json' | 'text' | 'buffer' | 'arrayBuffer' | 'blob' | 'formData' | 'stream';
export type RequestObjectBody = Record<string, unknown>;
export type ResponseObjectData = Record<string, unknown>;
export type RequestBody = JsonValue | RequestObjectBody | string | Buffer | Uint8Array | ArrayBuffer | URLSearchParams | Readable | Blob | FormData;
export type ParsedResponseData = JsonValue | ResponseObjectData | string | Buffer | Uint8Array | ArrayBuffer | Blob | FormData | IncomingMessage | Readable | ReadableStream<Uint8Array> | null;
export type ProgressEvent = {
    readonly loaded: number;
    readonly total?: number;
    readonly percent?: number;
    readonly progress?: number;
    readonly bytes: number;
    readonly rate: number;
    readonly estimated?: number;
    readonly upload?: true;
    readonly download?: true;
};
export type FetchCredentials = 'include' | 'omit' | 'same-origin';
export type FetchImplementation = typeof fetch;
export type MaxRate = number | readonly [uploadBytesPerSecond: number, downloadBytesPerSecond: number];
export type IdempotencyKey = string | (() => string) | true;
export type TransportRequest = ClientRequest | ClientHttp2Stream | Request;
export type ParamsSerializer =
    | ((params: QueryParams) => string)
    | {
        readonly encode?: (value: string) => string;
        readonly serialize?: (params: QueryParams) => string;
        readonly indexes?: boolean | null;
    };
export interface FormSerializerOptions {
    readonly dots?: boolean;
    readonly indexes?: boolean | null;
    readonly metaTokens?: boolean;
    readonly maxDepth?: number;
}
export type TransformRequest = (data: RequestBody | undefined, headers: InternalHeaders) => RequestBody | undefined;
export type TransformResponse = (data: ParsedResponseData, headers: Headers, status: number) => ParsedResponseData;
export type ParseJson = (text: string) => ParsedResponseData;
export type StringifyJson = (value: unknown) => string;
export type LookupFunction = NonNullable<RequestOptions['lookup']>;
export type NeutrxRequestConfig = InternalRequestConfig;
export interface NeutrxAdapter {
    (config: NeutrxRequestConfig): RawHttpResponse | Promise<RawHttpResponse>;
}
export type RequestAdapter = NeutrxAdapter;
export type RequestAdapterName = 'http' | 'fetch' | 'http2';
export type RequestAdapterConfig = RequestAdapterName | RequestAdapter;
export type MaybePromise<T> = T | Promise<T>;
export type Canceler = (message?: string) => void;
export type ValidationPath = readonly (string | number)[];

export interface ValidationIssue {
    readonly path?: ValidationPath;
    readonly message: string;
    readonly code?: string;
}

export interface ValidationSuccess<TData = unknown> {
    readonly success: true;
    readonly data?: TData;
}

export interface ValidationFailure {
    readonly success: false;
    readonly error?: unknown;
    readonly issues?: readonly ValidationIssue[];
}

export type ValidationResult<TData = unknown> =
    | boolean
    | void
    | ValidationIssue
    | readonly ValidationIssue[]
    | ValidationSuccess<TData>
    | ValidationFailure
    | TData;

export type ValidationFunction<TData = unknown, TInput = unknown> = ((value: TInput) => ValidationResult<TData> | Promise<ValidationResult<TData>>) & {
    readonly errors?: unknown;
};

export type ValidationSchema<TData = unknown, TInput = unknown> =
    | ValidationFunction<TData, TInput>
    | {
        readonly parse: (value: TInput) => TData | Promise<TData>;
    }
    | {
        readonly safeParse: (value: TInput) => ValidationSuccess<TData> | ValidationFailure | Promise<ValidationSuccess<TData> | ValidationFailure>;
    }
    | {
        readonly validate: (value: TInput) => ValidationResult<TData> | Promise<ValidationResult<TData>>;
        readonly errors?: unknown;
    }
    | {
        readonly Check: (value: TInput) => boolean;
        readonly Errors?: (value: TInput) => Iterable<unknown>;
    };

type InferValidationResult<TResult> =
    TResult extends PromiseLike<infer TAwaited> ? InferValidationResult<TAwaited>
    : TResult extends ValidationSuccess<infer TData> ? TData
    : TResult extends ValidationFailure ? never
    : TResult extends boolean | void | ValidationIssue | readonly ValidationIssue[] ? unknown
    : TResult;

type IsUnknown<TValue> = unknown extends TValue
    ? [TValue] extends [unknown] ? true : false
    : false;

export type InferValidationSchema<TSchema> =
    TSchema extends { readonly parse: (...args: readonly unknown[]) => infer TResult } ? Awaited<TResult>
    : TSchema extends { readonly safeParse: (...args: readonly unknown[]) => infer TResult } ? InferValidationResult<TResult>
    : TSchema extends { readonly validate: (...args: readonly unknown[]) => infer TResult } ? InferValidationResult<TResult>
    : TSchema extends (...args: readonly unknown[]) => infer TResult ? InferValidationResult<TResult>
    : TSchema extends { readonly Check: (...args: readonly unknown[]) => boolean } ? unknown
    : unknown;

export type ResponseValidationSchema<TData = unknown> = ValidationSchema<TData, ParsedResponseData>;
export type ResponseSchemaOption<TData = unknown> = ResponseValidationSchema<TData> | false;
export type SchemaResponseData<TFallback extends ParsedResponseData, TSchema> =
    [TSchema] extends [false | undefined] ? TFallback
    : InferValidationSchema<Exclude<TSchema, false | undefined>> extends infer TInferred
        ? IsUnknown<TInferred> extends true
            ? TFallback
            : TInferred extends ParsedResponseData ? TInferred : ParsedResponseData
        : TFallback;

export interface RequestValidationConfig {
    readonly request?: ValidationSchema | false;
    readonly response?: ResponseValidationSchema | false;
}

export type ValidationPluginConfig = RequestValidationConfig;

export type NeutrxLogValue = string | number | boolean | null | undefined | readonly NeutrxLogValue[] | { readonly [key: string]: NeutrxLogValue };

export interface NeutrxLogger {
    info?(entry: Record<string, NeutrxLogValue>): void;
    error?(entry: Record<string, NeutrxLogValue>): void;
    warn?(entry: Record<string, NeutrxLogValue>): void;
    debug?(entry: Record<string, NeutrxLogValue>): void;
}

export interface NeutrxWebSocketReconnectOptions {
    readonly attempts?: number;
    readonly delay?: number;
    readonly backoff?: 'fixed' | 'linear' | 'exponential' | ((attempt: number) => number);
    /** @deprecated Use delay instead. */
    readonly minDelay?: number;
    /** @deprecated Use backoff instead. */
    readonly factor?: number;
    readonly maxDelay?: number;
}

export type NeutrxWebSocketData = string | ArrayBuffer | Uint8Array | Blob;
export type NeutrxWebSocketMessage = NeutrxWebSocketData;

export interface NeutrxWebSocketOpenEvent {
    readonly type: 'open';
    readonly url: string;
    readonly nativeEvent?: unknown;
}

export interface NeutrxWebSocketMessageEvent<TMessage = NeutrxWebSocketData> {
    readonly type: 'message';
    readonly data: TMessage;
    readonly raw: NeutrxWebSocketData;
    readonly nativeEvent?: unknown;
}

export interface NeutrxWebSocketErrorEvent {
    readonly type: 'error';
    readonly error?: Error;
    readonly nativeEvent?: unknown;
}

export interface NeutrxWebSocketCloseEvent {
    readonly type: 'close';
    readonly code: number;
    readonly reason: string;
    readonly wasClean: boolean;
    readonly nativeEvent?: unknown;
}

export interface NeutrxWebSocketOptions<
    TMessage = NeutrxWebSocketData,
    TSend extends NeutrxWebSocketMessage = NeutrxWebSocketMessage
> {
    readonly protocols?: string | readonly string[];
    readonly reconnect?: boolean | NeutrxWebSocketReconnectOptions;
    readonly webSocket?: typeof WebSocket;
    readonly headers?: HeaderSource;
    readonly auth?: BasicAuthConfig;
    readonly params?: QueryParams;
    readonly paramsSerializer?: ParamsSerializer;
    readonly baseURL?: string;
    readonly allowAbsoluteUrls?: boolean;
    readonly timeout?: number;
    readonly connectTimeout?: number;
    readonly signal?: AbortSignal;
    readonly serviceDiscovery?: ServiceDiscoveryConfig;
    readonly parseMessage?: (data: NeutrxWebSocketData) => TMessage;
    readonly serializeMessage?: (data: TSend) => NeutrxWebSocketMessage;
    readonly onOpen?: (event: NeutrxWebSocketOpenEvent) => void;
    readonly onMessage?: (data: TMessage, event: NeutrxWebSocketMessageEvent<TMessage>) => void;
    readonly onError?: (event: NeutrxWebSocketErrorEvent) => void;
    readonly onClose?: (event: NeutrxWebSocketCloseEvent) => void;
}

declare const neutrxWebSocketMessageType: unique symbol;

export interface NeutrxWSConnection<
    TMessage = NeutrxWebSocketData,
    TSend extends NeutrxWebSocketMessage = NeutrxWebSocketMessage
> {
    readonly url: string;
    readonly readyState: number | undefined;
    readonly [neutrxWebSocketMessageType]?: TMessage;
    send(data: TSend): void;
    close(code?: number, reason?: string): void;
}

export interface Cancel {
    readonly __CANCEL__: true;
    readonly name: string;
    readonly message: string;
}

export interface CancelToken {
    readonly promise: Promise<Cancel>;
    readonly reason: Cancel | undefined;
    throwIfRequested(): void;
    toAbortSignal(): AbortSignal;
}

export interface CancelTokenSource {
    readonly token: CancelToken;
    readonly cancel: Canceler;
}

export interface ServiceEndpoint {
    readonly url: string;
    readonly weight?: number;
    readonly metadata?: Record<string, JsonValue>;
}

export interface ServiceResolverContext {
    readonly request: RequestConfig;
    readonly baseURL?: string;
    readonly url: string;
    readonly method: HttpMethod;
}

export type ServiceResolver = readonly (ServiceEndpoint | string)[] | ((context: ServiceResolverContext) => MaybePromise<readonly (ServiceEndpoint | string)[]>);
export type LoadBalancingStrategy = 'round-robin' | 'random' | 'sticky-origin';

export interface ServiceDiscoveryConfig {
    readonly resolver: ServiceResolver;
    readonly strategy?: LoadBalancingStrategy;
    readonly maxEndpoints?: number;
}

export interface ProxyConfig {
    readonly protocol?: 'http' | 'https';
    readonly host: string;
    readonly port?: number;
    readonly auth?: BasicAuthConfig | string;
    readonly headers?: HeaderSource;
}

export interface BasicAuthConfig {
    readonly username: string;
    readonly password: string;
}

export interface CertificatePinConfig {
    readonly hostname: string;
    readonly sha256: string;
    readonly validFrom?: string | number | Date;
    readonly expiresAt?: string | number | Date;
}

export interface TlsConfig extends Pick<SecureContextOptions, 'ca' | 'cert' | 'key' | 'pfx' | 'passphrase'> {
    readonly servername?: string;
    readonly rejectUnauthorized?: boolean;
    readonly certificatePins?: readonly CertificatePinConfig[];
}

export type EgressPolicyMode = 'public-api' | 'internal-service' | 'webhook-target' | 'legacy-migration';

export interface EgressPolicyConfig {
    readonly mode?: EgressPolicyMode;
    readonly allowedProtocols?: readonly string[];
    readonly allowedHosts?: readonly string[];
    readonly deniedHosts?: readonly string[];
    readonly allowedCidrs?: readonly string[];
    readonly deniedCidrs?: readonly string[];
    readonly allowedPorts?: readonly number[];
    readonly requireHttps?: boolean;
    readonly allowRedirectsTo?: readonly string[];
    readonly blockCloudMetadata?: boolean;
    readonly requirePublicDns?: boolean;
    readonly allowedSni?: readonly string[];
}

export interface EgressPolicyAudit {
    readonly mode: EgressPolicyMode | 'custom';
    readonly allowedProtocols: readonly string[];
    readonly requireHttps: boolean;
    readonly requirePublicDns: boolean;
    readonly blockCloudMetadata: boolean;
    readonly allowedHosts?: readonly string[];
    readonly deniedHosts?: readonly string[];
    readonly allowedCidrs?: readonly string[];
    readonly deniedCidrs?: readonly string[];
    readonly allowedPorts?: readonly number[];
    readonly allowRedirectsTo?: readonly string[];
    readonly allowedSni?: readonly string[];
}

export interface RedirectContext {
    readonly statusCode: number;
    readonly location: string;
    readonly fromURL: string;
    readonly toURL: string;
    readonly headers: Headers;
}

export interface TransitionalConfig {
    readonly clarifyTimeoutError?: boolean;
}

export type SecurityProfile = 'strict' | 'standard' | 'legacy';
export type DeprecatedSecurityProfile = 'balanced';
export type SecurityProfileInput = SecurityProfile | DeprecatedSecurityProfile;

export type RetryBudgetScope = 'client' | 'origin' | 'global';

export interface RetryBudgetSnapshot {
    readonly key: string;
    readonly spent: number;
    readonly remaining: number;
    readonly resetAt: number;
}

export interface RetryBudgetStore {
    consume(key: string, limit: number, windowMs: number, now: number): MaybePromise<boolean>;
    snapshot?(key: string, limit: number, windowMs: number, now: number): MaybePromise<RetryBudgetSnapshot>;
}

export interface RetryBudgetConfig {
    readonly maxRetries: number;
    readonly windowMs: number;
    readonly scope?: RetryBudgetScope;
    readonly namespace?: string;
    readonly store?: RetryBudgetStore;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitStateStore {
    get(key: string): MaybePromise<CircuitStatus | undefined>;
    set(key: string, value: CircuitStatus): MaybePromise<void>;
    delete?(key: string): MaybePromise<void>;
    keys?(): MaybePromise<Iterable<string>>;
}

export interface CircuitBreakerStorageConfig {
    readonly store: CircuitStateStore;
    readonly scope?: 'origin' | 'global';
    readonly namespace?: string;
}

export interface AdaptiveConcurrencyConfig {
    readonly enabled?: boolean;
    readonly initialLimit?: number;
    readonly minLimit?: number;
    readonly maxLimit?: number;
    readonly targetLatency?: number;
    readonly increaseStep?: number;
    readonly decreaseRatio?: number;
}

export interface SecurityConfig {
    readonly profile?: SecurityProfileInput;
    readonly allowedHosts?: readonly string[];
    readonly deniedHosts?: readonly string[];
    readonly allowedProtocols?: readonly string[];
    readonly enforceHTTPS?: boolean;
    readonly validateCertificate?: boolean;
    readonly enableSSRFProtection?: boolean;
    readonly blockPrivateIPs?: boolean;
    readonly blockLinkLocalIPs?: boolean;
    readonly blockLoopbackIPs?: boolean;
    readonly blockMetadataIPs?: boolean;
    readonly blockDangerousPorts?: boolean;
    readonly reResolveOnRedirect?: boolean;
    readonly blockRedirectToPrivateIP?: boolean;
    readonly allowLocalhost?: boolean;
    readonly sanitizeInputs?: boolean;
    readonly sanitizeOutputs?: boolean;
    readonly rateLimit?: RateLimitConfig;
}

export interface RateLimitConfig {
    readonly enabled?: boolean;
    readonly algorithm?: 'token_bucket' | 'sliding_window' | 'fixed_window';
    readonly maxRequests?: number;
    readonly windowMs?: number;
    readonly burstSize?: number;
    readonly perDomain?: boolean;
}

export interface ResilienceConfig {
    readonly enableCircuitBreaker?: boolean;
    readonly failureThreshold?: number;
    readonly successThreshold?: number;
    readonly circuitTimeout?: number;
    readonly circuitBreakerStorage?: CircuitBreakerStorageConfig;
    readonly enableRetry?: boolean;
    readonly maxRetries?: number;
    readonly retryStrategy?: 'fixed' | 'linear' | 'exponential' | 'fibonacci';
    readonly retryDelay?: number;
    readonly maxRetryDelay?: number;
    readonly retryJitter?: boolean;
    readonly retryMethods?: readonly HttpMethod[];
    readonly retryBudget?: RetryBudgetConfig;
    readonly retryableStatuses?: readonly number[];
    readonly retryableCodes?: readonly string[];
    readonly shouldRetry?: (error: Error) => boolean;
    readonly onRetry?: (event: RetryEvent) => void | Promise<void>;
    readonly enableBulkhead?: boolean;
    readonly maxConcurrent?: number;
    readonly maxQueue?: number;
    readonly bulkheadQueueTimeout?: number;
    readonly adaptiveConcurrency?: AdaptiveConcurrencyConfig;
}

export interface CacheRecord {
    readonly response: NeutrxResponse;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly staleUntil: number;
    readonly staleIfErrorUntil: number;
    lastAccessed: number;
    revalidatingAt?: number;
    readonly size: number;
}

export interface CacheStore {
    get(key: string): CacheRecord | undefined;
    set(key: string, value: CacheRecord): void;
    delete(key: string): void;
    clear(): void;
    keys(): Iterable<string>;
    lock?(key: string): boolean;
    unlock?(key: string): void;
    destroy?(): void;
}

export type DeduplicateRequestKey = (config: InternalRequestConfig) => string | null | undefined;
export type CacheStrategy = 'max-age' | 'swr' | 'network-first';
export type DeprecatedCacheStrategy = 'ttl' | 'stale-while-revalidate';
export type CacheStrategyInput = CacheStrategy | DeprecatedCacheStrategy;
export type CacheRevalidateReason = 'stale' | 'network-first';

export interface CacheRevalidateEvent {
    readonly requestId: string;
    readonly url: string;
    readonly strategy: CacheStrategy;
    readonly reason: CacheRevalidateReason;
    readonly updated: boolean;
    readonly status?: number;
    readonly error?: Error;
    readonly skipped?: boolean;
}

export interface PerformanceConfig {
    readonly enableCaching?: boolean;
    readonly cacheMaxSize?: number;
    readonly cacheTTL?: number;
    readonly cacheMaxEntrySize?: number;
    readonly respectCacheHeaders?: boolean;
    readonly deduplicateRequests?: boolean;
    readonly deduplicateRequestKey?: DeduplicateRequestKey;
    readonly deduplicateMethods?: readonly HttpMethod[];
    readonly deduplicateHeaders?: readonly string[];
    readonly cacheStrategy?: CacheStrategyInput;
    readonly revalidateAfter?: number;
    readonly cacheStaleMax?: number;
    readonly cacheAdapter?: CacheStore;
    readonly onRevalidate?: (event: CacheRevalidateEvent) => void | Promise<void>;
}

export interface Http2Options {
    readonly sessionTimeout?: number;
    readonly rejectUnauthorized?: boolean;
    readonly maxSessions?: number;
    readonly maxConcurrentStreams?: number;
}

export interface Http2SessionStats {
    readonly sessions: number;
    readonly origins: Record<string, {
        readonly activeStreams: number;
        readonly closed: boolean;
        readonly destroyed: boolean;
        readonly sessionCount?: number;
        readonly remoteMaxConcurrentStreams?: number;
    }>;
}

export interface InstrumentationConfig {
    readonly openTelemetry?: boolean;
    readonly tracerName?: string;
    readonly propagateTraceHeaders?: boolean;
    readonly overwriteTraceHeaders?: boolean;
    readonly recordRequestBodySize?: boolean;
    readonly recordResponseBodySize?: boolean;
}

export type TracePropagationFormat = 'w3c' | 'b3' | 'b3multi' | 'b3single' | 'b3-multi' | 'b3-single';

export interface TraceContext {
    readonly traceId?: string;
    readonly spanId?: string;
    readonly parentSpanId?: string;
    readonly sampled?: boolean;
    readonly tracestate?: string;
}

export interface TraceContextPluginOptions {
    readonly formats?: TracePropagationFormat | readonly TracePropagationFormat[];
    readonly context?: TraceContext | ((config: InternalRequestConfig) => TraceContext | undefined);
    readonly sampled?: boolean;
    readonly tracestate?: string | ((config: InternalRequestConfig) => string | undefined);
    readonly overwrite?: boolean;
}

export interface ClientConfig {
    readonly baseURL?: string;
    readonly allowAbsoluteUrls?: boolean;
    readonly timeout?: number;
    readonly connectTimeout?: number;
    readonly maxRedirects?: number;
    readonly maxContentLength?: number;
    readonly maxBodyLength?: number;
    readonly responseEncoding?: BufferEncoding;
    readonly headers?: HeaderSource;
    readonly auth?: BasicAuthConfig;
    readonly idempotencyKey?: IdempotencyKey;
    readonly idempotencyKeyHeader?: string;
    readonly validateStatus?: (status: number) => boolean;
    readonly paramsSerializer?: ParamsSerializer;
    readonly formSerializer?: FormSerializerOptions;
    readonly transformRequest?: TransformRequest | readonly TransformRequest[];
    readonly transformResponse?: TransformResponse | readonly TransformResponse[];
    readonly schema?: ResponseSchemaOption | undefined;
    readonly parseJson?: ParseJson;
    readonly stringifyJson?: StringifyJson;
    readonly throwHttpErrors?: boolean;
    readonly adapter?: RequestAdapterConfig;
    readonly fetch?: FetchImplementation;
    readonly httpVersion?: 1 | 2 | '1.1' | '2';
    readonly http2Options?: Http2Options;
    readonly serviceDiscovery?: ServiceDiscoveryConfig;
    readonly withCredentials?: boolean;
    readonly credentials?: FetchCredentials;
    readonly xsrfCookieName?: string | null;
    readonly xsrfHeaderName?: string | null;
    readonly withXSRFToken?: boolean | ((config: InternalRequestConfig) => boolean);
    readonly instrumentation?: InstrumentationConfig;
    readonly proxy?: ProxyConfig | false;
    readonly tls?: TlsConfig;
    readonly beforeRedirect?: (context: RedirectContext) => void | Promise<void>;
    readonly httpAgent?: HttpAgent;
    readonly httpsAgent?: HttpsAgent;
    readonly lookup?: LookupFunction;
    readonly socketPath?: string;
    readonly decompress?: boolean;
    readonly maxRate?: MaxRate;
    readonly transitional?: TransitionalConfig;
    readonly security?: SecurityConfig;
    readonly egressPolicy?: EgressPolicyConfig;
    readonly resilience?: ResilienceConfig;
    readonly performance?: PerformanceConfig;
}

export interface NormalizedClientConfig extends Required<Omit<ClientConfig, 'baseURL' | 'headers' | 'auth' | 'idempotencyKey' | 'idempotencyKeyHeader' | 'paramsSerializer' | 'formSerializer' | 'transformRequest' | 'transformResponse' | 'schema' | 'parseJson' | 'stringifyJson' | 'adapter' | 'fetch' | 'httpVersion' | 'http2Options' | 'serviceDiscovery' | 'withCredentials' | 'credentials' | 'xsrfCookieName' | 'xsrfHeaderName' | 'withXSRFToken' | 'instrumentation' | 'proxy' | 'tls' | 'beforeRedirect' | 'httpAgent' | 'httpsAgent' | 'lookup' | 'socketPath' | 'maxRate' | 'security' | 'egressPolicy' | 'resilience' | 'performance' | 'transitional'>> {
    readonly baseURL?: string;
    readonly headers?: HeaderSource;
    readonly auth?: BasicAuthConfig;
    readonly idempotencyKey?: IdempotencyKey;
    readonly idempotencyKeyHeader?: string;
    readonly paramsSerializer?: ParamsSerializer;
    readonly formSerializer?: FormSerializerOptions;
    readonly transformRequest?: readonly TransformRequest[];
    readonly transformResponse?: readonly TransformResponse[];
    readonly schema?: ResponseSchemaOption | undefined;
    readonly parseJson?: ParseJson;
    readonly stringifyJson?: StringifyJson;
    readonly adapter?: RequestAdapterConfig;
    readonly fetch?: FetchImplementation;
    readonly httpVersion?: 1 | 2 | '1.1' | '2';
    readonly http2Options?: Http2Options;
    readonly serviceDiscovery?: ServiceDiscoveryConfig;
    readonly withCredentials?: boolean;
    readonly credentials?: FetchCredentials;
    readonly xsrfCookieName?: string | null;
    readonly xsrfHeaderName?: string | null;
    readonly withXSRFToken?: boolean | ((config: InternalRequestConfig) => boolean);
    readonly instrumentation?: InstrumentationConfig;
    readonly proxy?: ProxyConfig | false;
    readonly tls?: TlsConfig;
    readonly beforeRedirect?: (context: RedirectContext) => void | Promise<void>;
    readonly httpAgent?: HttpAgent;
    readonly httpsAgent?: HttpsAgent;
    readonly lookup?: LookupFunction;
    readonly socketPath?: string;
    readonly maxRate?: MaxRate;
    readonly egressPolicy?: EgressPolicyConfig;
    readonly transitional: Required<TransitionalConfig>;
    readonly security: Required<Omit<SecurityConfig, 'profile' | 'rateLimit' | 'allowedHosts' | 'deniedHosts' | 'allowedProtocols'>> & {
        readonly profile: SecurityProfile;
        readonly allowedHosts?: readonly string[];
        readonly deniedHosts?: readonly string[];
        readonly allowedProtocols?: readonly string[];
        readonly rateLimit?: RateLimitConfig;
    };
    readonly resilience: Required<Omit<ResilienceConfig, 'shouldRetry' | 'onRetry' | 'retryableStatuses' | 'retryableCodes' | 'retryBudget' | 'adaptiveConcurrency' | 'circuitBreakerStorage'>> & {
        readonly retryableStatuses: readonly number[];
        readonly retryableCodes: readonly string[];
        readonly retryMethods: readonly HttpMethod[];
        readonly retryBudget?: RetryBudgetConfig;
        readonly adaptiveConcurrency?: AdaptiveConcurrencyConfig;
        readonly circuitBreakerStorage?: CircuitBreakerStorageConfig;
        readonly shouldRetry?: (error: Error) => boolean;
        readonly onRetry?: (event: RetryEvent) => void | Promise<void>;
    };
    readonly performance: Required<Omit<PerformanceConfig, 'cacheAdapter' | 'deduplicateRequestKey' | 'cacheStrategy' | 'revalidateAfter' | 'onRevalidate'>> & {
        readonly cacheStrategy: CacheStrategy;
        readonly revalidateAfter?: number;
        readonly cacheAdapter?: CacheStore;
        readonly deduplicateRequestKey?: DeduplicateRequestKey;
        readonly onRevalidate?: (event: CacheRevalidateEvent) => void | Promise<void>;
    };
}

export interface RequestConfig<
    TBody extends RequestBody = RequestBody,
    TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
> {
    readonly url: string;
    readonly method?: HttpMethod | Lowercase<HttpMethod>;
    readonly data?: TBody;
    readonly params?: QueryParams;
    readonly headers?: HeaderSource;
    readonly auth?: BasicAuthConfig;
    readonly idempotencyKey?: IdempotencyKey;
    readonly idempotencyKeyHeader?: string;
    readonly baseURL?: string;
    readonly allowAbsoluteUrls?: boolean;
    readonly timeout?: number;
    readonly connectTimeout?: number;
    readonly maxRedirects?: number;
    readonly maxContentLength?: number;
    readonly maxBodyLength?: number;
    readonly responseType?: ResponseType;
    readonly responseEncoding?: BufferEncoding;
    readonly validateStatus?: (status: number) => boolean;
    readonly paramsSerializer?: ParamsSerializer;
    readonly formSerializer?: FormSerializerOptions;
    readonly transformRequest?: TransformRequest | readonly TransformRequest[];
    readonly transformResponse?: TransformResponse | readonly TransformResponse[];
    readonly schema?: TSchema;
    readonly parseJson?: ParseJson;
    readonly stringifyJson?: StringifyJson;
    readonly throwHttpErrors?: boolean;
    readonly adapter?: RequestAdapterConfig;
    readonly fetch?: FetchImplementation;
    readonly httpVersion?: 1 | 2 | '1.1' | '2';
    readonly http2Options?: Http2Options;
    readonly serviceDiscovery?: ServiceDiscoveryConfig;
    readonly withCredentials?: boolean;
    readonly credentials?: FetchCredentials;
    readonly xsrfCookieName?: string | null;
    readonly xsrfHeaderName?: string | null;
    readonly withXSRFToken?: boolean | ((config: InternalRequestConfig) => boolean);
    readonly instrumentation?: InstrumentationConfig;
    readonly proxy?: ProxyConfig | false;
    readonly tls?: TlsConfig;
    readonly beforeRedirect?: (context: RedirectContext) => void | Promise<void>;
    readonly httpAgent?: HttpAgent;
    readonly httpsAgent?: HttpsAgent;
    readonly lookup?: LookupFunction;
    readonly socketPath?: string;
    readonly decompress?: boolean;
    readonly maxRate?: MaxRate;
    readonly transitional?: TransitionalConfig;
    readonly followRedirects?: boolean;
    readonly cache?: boolean;
    readonly signal?: AbortSignal;
    readonly cancelToken?: CancelToken;
    readonly validation?: RequestValidationConfig;
    readonly skipOAuth?: boolean;
    readonly onUploadProgress?: (event: ProgressEvent) => void;
    readonly onDownloadProgress?: (event: ProgressEvent) => void;
}

export interface InternalRequestConfig<TBody extends RequestBody = RequestBody> extends RequestConfig<TBody> {
    readonly url: string;
    readonly method: HttpMethod;
    readonly headers: InternalHeaders;
    readonly allowAbsoluteUrls: boolean;
    readonly timeout: number;
    readonly connectTimeout: number;
    readonly maxRedirects: number;
    readonly maxContentLength: number;
    readonly maxBodyLength: number;
    readonly responseType: ResponseType;
    readonly responseEncoding: BufferEncoding;
    readonly validateStatus: (status: number) => boolean;
    readonly formSerializer?: FormSerializerOptions;
    readonly transformRequest?: readonly TransformRequest[];
    readonly transformResponse?: readonly TransformResponse[];
    readonly schema?: ResponseSchemaOption | undefined;
    readonly parseJson?: ParseJson;
    readonly stringifyJson?: StringifyJson;
    readonly throwHttpErrors: boolean;
    readonly adapter?: RequestAdapterConfig;
    readonly fetch?: FetchImplementation;
    readonly httpVersion?: 1 | 2 | '1.1' | '2';
    readonly http2Options?: Http2Options;
    readonly serviceDiscovery?: ServiceDiscoveryConfig;
    readonly serviceEndpoint?: ServiceEndpoint;
    readonly withCredentials?: boolean;
    readonly credentials?: FetchCredentials;
    readonly xsrfCookieName?: string | null;
    readonly xsrfHeaderName?: string | null;
    readonly withXSRFToken?: boolean | ((config: InternalRequestConfig) => boolean);
    readonly instrumentation?: InstrumentationConfig;
    readonly proxy?: ProxyConfig | false;
    readonly socketPath?: string;
    readonly decompress: boolean;
    readonly maxRate?: MaxRate;
    readonly transitional: Required<TransitionalConfig>;
    readonly followRedirects: boolean;
    readonly requestId: string;
    readonly startTime: number;
    readonly hops: number;
    readonly mockResponse?: NeutrxResponse;
    readonly idempotencyKey?: string;
    readonly idempotencyKeyHeader?: string;
}

export interface RawHttpResponse {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly data: string | Buffer | Uint8Array | ArrayBuffer | Blob | FormData | IncomingMessage | Readable | ReadableStream<Uint8Array> | null;
    readonly config: InternalRequestConfig;
    readonly request?: TransportRequest;
    readonly deduplicated?: boolean;
}

export interface NeutrxResponse<TData extends ParsedResponseData = ParsedResponseData> {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    data: TData;
    readonly config: InternalRequestConfig;
    readonly request?: TransportRequest;
    readonly timing: { readonly duration: number };
    readonly requestId: string;
    attempts?: readonly RetryAttempt[];
    cached?: boolean;
    cacheAge?: number;
    stale?: boolean;
    deduplicated?: boolean;
}

export interface RetryAttempt {
    readonly attempt: number;
    readonly duration: number;
    readonly success: boolean;
    readonly error?: string;
}

export interface RetryEvent {
    readonly attempt: number;
    readonly delay: number;
    readonly error: Error;
    readonly context: RetryContext;
}

export interface RetryContext {
    readonly url?: string;
    readonly method?: HttpMethod;
    readonly signal?: AbortSignal;
    readonly deadlineAt?: number;
    readonly idempotencyKey?: string;
}

export interface ConcurrentOptions {
    readonly limit?: number;
    readonly failFast?: boolean;
    readonly timeout?: number;
    readonly onProgress?: (done: number, total: number, index: number, error: Error | null) => void;
}

export interface ConcurrentResult<TData extends ParsedResponseData = ParsedResponseData> {
    readonly results: Array<NeutrxResponse<TData> | null>;
    readonly errors: Array<Error | null>;
    readonly completed: number;
}

export interface PaginationOptions {
    readonly pageParam?: string;
    readonly limitParam?: string;
    readonly pageSize?: number;
    readonly dataPath?: string;
    readonly hasMorePath?: string;
    readonly maxPages?: number;
}

export interface PaginationPage<TData extends ParsedResponseData = ParsedResponseData> {
    readonly data: TData;
    readonly page: number;
    readonly response: NeutrxResponse;
}

export interface OAuth2Config {
    readonly tokenURL: string;
    readonly clientId?: string;
    readonly clientSecret?: string;
    readonly scope?: string;
    readonly grantType?: string;
}

export interface GraphQLResult<TData extends JsonValue = JsonValue> extends NeutrxResponse<TData | null> {
    readonly extensions?: JsonValue;
}

export interface MockResponse<TData extends ParsedResponseData = ParsedResponseData> {
    readonly status?: number;
    readonly statusText?: string;
    readonly headers?: Headers;
    readonly data?: TData;
    readonly delay?: number;
}

export interface MockController {
    enable(): MockController;
    disable(): MockController;
    clear(): MockController;
    register<TData extends ParsedResponseData>(urlPattern: string | RegExp, response: MockResponse<TData>): MockController;
}

export interface SseHandle {
    close(): void;
}

export interface AuthConfig {
    readonly bearer?: string;
    readonly basic?: { readonly username: string; readonly password: string };
    readonly apiKey?: { readonly key: string; readonly header?: string };
}

export interface CacheStats {
    readonly hits: number;
    readonly misses: number;
    readonly evictions: number;
    readonly sets: number;
    readonly size: number;
    readonly maxSize: number;
    readonly hitRate: string;
}

export interface CircuitStatus {
    readonly state: CircuitState;
    readonly failures?: number;
    readonly successCount?: number;
    readonly active?: number;
    readonly openedAt?: number | null;
    readonly lastFailure?: number | null;
}

export interface BulkheadStats {
    readonly domains: Record<string, { readonly active: number; readonly queued: number; readonly limit?: number; readonly adaptive?: boolean }>;
}
