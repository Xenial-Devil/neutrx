import type { Agent as HttpAgent, IncomingMessage, RequestOptions } from 'node:http';
import type { Agent as HttpsAgent } from 'node:https';
import type { Readable } from 'node:stream';

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonArray = readonly JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type HeaderValue = string | number | boolean | readonly string[];
export type Headers = Record<string, HeaderValue>;
export type QueryValue = string | number | boolean | readonly (string | number | boolean)[] | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ResponseType = 'json' | 'text' | 'buffer' | 'stream';
export type RequestBody = JsonValue | string | Buffer | Uint8Array | ArrayBuffer | URLSearchParams | Readable | Blob | FormData;
export type ParsedResponseData = JsonValue | string | Buffer | IncomingMessage | null;
export type ProgressEvent = { readonly loaded: number; readonly total?: number; readonly percent?: number };
export type ParamsSerializer =
    | ((params: QueryParams) => string)
    | {
        readonly encode?: (value: string) => string;
        readonly serialize?: (params: QueryParams) => string;
        readonly indexes?: boolean | null;
    };
export type TransformRequest = (data: RequestBody | undefined, headers: Headers) => RequestBody | undefined;
export type TransformResponse = (data: ParsedResponseData, headers: Headers, status: number) => ParsedResponseData;
export type LookupFunction = NonNullable<RequestOptions['lookup']>;
export type RequestAdapter = (config: InternalRequestConfig) => RawHttpResponse | Promise<RawHttpResponse>;

export interface ProxyConfig {
    readonly protocol?: 'http' | 'https';
    readonly host: string;
    readonly port?: number;
    readonly auth?: { readonly username: string; readonly password: string } | string;
    readonly headers?: Headers;
}

export interface RedirectContext {
    readonly statusCode: number;
    readonly location: string;
    readonly fromURL: string;
    readonly toURL: string;
    readonly headers: Headers;
}

export interface SecurityConfig {
    readonly enforceHTTPS?: boolean;
    readonly validateCertificate?: boolean;
    readonly enableSSRFProtection?: boolean;
    readonly blockPrivateIPs?: boolean;
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
    readonly enableRetry?: boolean;
    readonly maxRetries?: number;
    readonly retryStrategy?: 'fixed' | 'linear' | 'exponential' | 'fibonacci';
    readonly retryDelay?: number;
    readonly maxRetryDelay?: number;
    readonly retryJitter?: boolean;
    readonly retryableStatuses?: readonly number[];
    readonly retryableCodes?: readonly string[];
    readonly shouldRetry?: (error: Error) => boolean;
    readonly onRetry?: (event: RetryEvent) => void | Promise<void>;
    readonly enableBulkhead?: boolean;
    readonly maxConcurrent?: number;
    readonly maxQueue?: number;
    readonly bulkheadQueueTimeout?: number;
}

export interface PerformanceConfig {
    readonly enableCaching?: boolean;
    readonly cacheMaxSize?: number;
    readonly cacheTTL?: number;
    readonly cacheMaxEntrySize?: number;
    readonly respectCacheHeaders?: boolean;
}

export interface ClientConfig {
    readonly baseURL?: string;
    readonly timeout?: number;
    readonly connectTimeout?: number;
    readonly maxRedirects?: number;
    readonly maxContentLength?: number;
    readonly maxBodyLength?: number;
    readonly headers?: Headers;
    readonly validateStatus?: (status: number) => boolean;
    readonly paramsSerializer?: ParamsSerializer;
    readonly transformRequest?: TransformRequest | readonly TransformRequest[];
    readonly transformResponse?: TransformResponse | readonly TransformResponse[];
    readonly adapter?: RequestAdapter;
    readonly proxy?: ProxyConfig | false;
    readonly httpAgent?: HttpAgent;
    readonly httpsAgent?: HttpsAgent;
    readonly lookup?: LookupFunction;
    readonly security?: SecurityConfig;
    readonly resilience?: ResilienceConfig;
    readonly performance?: PerformanceConfig;
}

export interface NormalizedClientConfig extends Required<Omit<ClientConfig, 'baseURL' | 'headers' | 'paramsSerializer' | 'transformRequest' | 'transformResponse' | 'adapter' | 'proxy' | 'httpAgent' | 'httpsAgent' | 'lookup' | 'security' | 'resilience' | 'performance'>> {
    readonly baseURL?: string;
    readonly headers?: Headers;
    readonly paramsSerializer?: ParamsSerializer;
    readonly transformRequest?: readonly TransformRequest[];
    readonly transformResponse?: readonly TransformResponse[];
    readonly adapter?: RequestAdapter;
    readonly proxy?: ProxyConfig | false;
    readonly httpAgent?: HttpAgent;
    readonly httpsAgent?: HttpsAgent;
    readonly lookup?: LookupFunction;
    readonly security: Required<Omit<SecurityConfig, 'rateLimit'>> & { readonly rateLimit?: RateLimitConfig };
    readonly resilience: Required<Omit<ResilienceConfig, 'shouldRetry' | 'onRetry' | 'retryableStatuses' | 'retryableCodes'>> & {
        readonly retryableStatuses: readonly number[];
        readonly retryableCodes: readonly string[];
        readonly shouldRetry?: (error: Error) => boolean;
        readonly onRetry?: (event: RetryEvent) => void | Promise<void>;
    };
    readonly performance: Required<PerformanceConfig>;
}

export interface RequestConfig<TBody extends RequestBody = RequestBody> {
    readonly url: string;
    readonly method?: HttpMethod | Lowercase<HttpMethod>;
    readonly data?: TBody;
    readonly params?: QueryParams;
    readonly headers?: Headers;
    readonly baseURL?: string;
    readonly timeout?: number;
    readonly connectTimeout?: number;
    readonly maxRedirects?: number;
    readonly maxContentLength?: number;
    readonly maxBodyLength?: number;
    readonly responseType?: ResponseType;
    readonly responseEncoding?: BufferEncoding;
    readonly validateStatus?: (status: number) => boolean;
    readonly paramsSerializer?: ParamsSerializer;
    readonly transformRequest?: TransformRequest | readonly TransformRequest[];
    readonly transformResponse?: TransformResponse | readonly TransformResponse[];
    readonly adapter?: RequestAdapter;
    readonly proxy?: ProxyConfig | false;
    readonly beforeRedirect?: (context: RedirectContext) => void | Promise<void>;
    readonly httpAgent?: HttpAgent;
    readonly httpsAgent?: HttpsAgent;
    readonly lookup?: LookupFunction;
    readonly followRedirects?: boolean;
    readonly cache?: boolean;
    readonly signal?: AbortSignal;
    readonly skipOAuth?: boolean;
    readonly onUploadProgress?: (event: ProgressEvent) => void;
    readonly onDownloadProgress?: (event: ProgressEvent) => void;
}

export interface InternalRequestConfig<TBody extends RequestBody = RequestBody> extends RequestConfig<TBody> {
    readonly url: string;
    readonly method: HttpMethod;
    readonly headers: Headers;
    readonly timeout: number;
    readonly connectTimeout: number;
    readonly maxRedirects: number;
    readonly maxContentLength: number;
    readonly maxBodyLength: number;
    readonly responseType: ResponseType;
    readonly responseEncoding: BufferEncoding;
    readonly validateStatus: (status: number) => boolean;
    readonly transformRequest?: readonly TransformRequest[];
    readonly transformResponse?: readonly TransformResponse[];
    readonly adapter?: RequestAdapter;
    readonly proxy?: ProxyConfig | false;
    readonly followRedirects: boolean;
    readonly requestId: string;
    readonly startTime: number;
    readonly hops: number;
    readonly mockResponse?: NeutrxResponse;
}

export interface RawHttpResponse {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly data: Buffer | IncomingMessage;
    readonly config: InternalRequestConfig;
}

export interface NeutrxResponse<TData extends ParsedResponseData = ParsedResponseData> {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    data: TData;
    readonly config: InternalRequestConfig;
    readonly timing: { readonly duration: number };
    readonly requestId: string;
    attempts?: readonly RetryAttempt[];
    cached?: boolean;
    cacheAge?: number;
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
    readonly state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    readonly failures?: number;
    readonly successCount?: number;
    readonly active?: number;
    readonly openedAt?: number | null;
    readonly lastFailure?: number | null;
}

export interface BulkheadStats {
    readonly domains: Record<string, { readonly active: number; readonly queued: number }>;
}
