"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const output = path.join(rootDir, "dist", "types", "browser.d.ts");

const contents = `
export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonArray = readonly JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type HeaderValue = string | number | boolean | readonly string[];
export type Headers = Record<string, HeaderValue>;
export type QueryValue = string | number | boolean | readonly (string | number | boolean)[] | null | undefined;
export type QueryParams = Record<string, QueryValue>;
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ResponseType = 'json' | 'text' | 'buffer' | 'arrayBuffer' | 'blob' | 'formData' | 'stream';
export type RequestObjectBody = Record<string, unknown>;
export type ResponseObjectData = Record<string, unknown>;
export type RequestBody = JsonValue | RequestObjectBody | string | Uint8Array | ArrayBuffer | URLSearchParams | Blob | FormData | ReadableStream<Uint8Array>;
export type ParsedResponseData = JsonValue | ResponseObjectData | string | Uint8Array | ArrayBuffer | Blob | FormData | ReadableStream<Uint8Array> | null;
export type ProgressEvent = { readonly loaded: number; readonly total?: number; readonly percent?: number };
export type FetchCredentials = 'include' | 'omit' | 'same-origin';
export type FetchImplementation = typeof fetch;
export type BufferEncoding = string;
export type ParamsSerializer =
  | ((params: QueryParams) => string)
  | { readonly encode?: (value: string) => string; readonly serialize?: (params: QueryParams) => string; readonly indexes?: boolean | null };
export interface FormSerializerOptions { readonly dots?: boolean; readonly indexes?: boolean | null; readonly metaTokens?: boolean; readonly maxDepth?: number }
export type TransformRequest = (data: RequestBody | undefined, headers: Headers) => RequestBody | undefined;
export type TransformResponse = (data: ParsedResponseData, headers: Headers, status: number) => ParsedResponseData;
export type RequestAdapter = (config: InternalRequestConfig) => RawHttpResponse | Promise<RawHttpResponse>;
export type RequestAdapterName = 'fetch';
export type RequestAdapterConfig = RequestAdapterName | RequestAdapter;

export type SecurityProfile = 'strict' | 'balanced' | 'axios-compatible';
export interface RetryBudgetConfig { readonly maxRetries: number; readonly windowMs: number }

export interface SecurityConfig {
  readonly profile?: SecurityProfile;
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
}

export interface PerformanceConfig {
  readonly enableCaching?: boolean;
  readonly cacheMaxSize?: number;
  readonly cacheTTL?: number;
  readonly cacheMaxEntrySize?: number;
  readonly respectCacheHeaders?: boolean;
}

export interface Http2Options { readonly sessionTimeout?: number; readonly rejectUnauthorized?: boolean; readonly maxSessions?: number }
export interface InstrumentationConfig { readonly openTelemetry?: boolean; readonly tracerName?: string; readonly propagateTraceHeaders?: boolean; readonly recordRequestBodySize?: boolean; readonly recordResponseBodySize?: boolean }

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
  readonly formSerializer?: FormSerializerOptions;
  readonly transformRequest?: TransformRequest | readonly TransformRequest[];
  readonly transformResponse?: TransformResponse | readonly TransformResponse[];
  readonly adapter?: RequestAdapterConfig;
  readonly fetch?: FetchImplementation;
  readonly httpVersion?: 1 | 2 | '1.1' | '2';
  readonly http2Options?: Http2Options;
  readonly withCredentials?: boolean;
  readonly credentials?: FetchCredentials;
  readonly xsrfCookieName?: string | null;
  readonly xsrfHeaderName?: string | null;
  readonly withXSRFToken?: boolean | ((config: InternalRequestConfig) => boolean);
  readonly instrumentation?: InstrumentationConfig;
  readonly decompress?: boolean;
  readonly security?: SecurityConfig;
  readonly resilience?: ResilienceConfig;
  readonly performance?: PerformanceConfig;
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
  readonly validateStatus?: (status: number) => boolean;
  readonly paramsSerializer?: ParamsSerializer;
  readonly formSerializer?: FormSerializerOptions;
  readonly transformRequest?: TransformRequest | readonly TransformRequest[];
  readonly transformResponse?: TransformResponse | readonly TransformResponse[];
  readonly adapter?: RequestAdapterConfig;
  readonly fetch?: FetchImplementation;
  readonly httpVersion?: 1 | 2 | '1.1' | '2';
  readonly http2Options?: Http2Options;
  readonly withCredentials?: boolean;
  readonly credentials?: FetchCredentials;
  readonly xsrfCookieName?: string | null;
  readonly xsrfHeaderName?: string | null;
  readonly withXSRFToken?: boolean | ((config: InternalRequestConfig) => boolean);
  readonly instrumentation?: InstrumentationConfig;
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
  readonly responseEncoding?: BufferEncoding;
  readonly validateStatus: (status: number) => boolean;
  readonly formSerializer?: FormSerializerOptions;
  readonly adapter?: RequestAdapterConfig;
  readonly fetch?: FetchImplementation;
  readonly httpVersion?: 1 | 2 | '1.1' | '2';
  readonly http2Options?: Http2Options;
  readonly withCredentials?: boolean;
  readonly credentials?: FetchCredentials;
  readonly xsrfCookieName?: string | null;
  readonly xsrfHeaderName?: string | null;
  readonly withXSRFToken?: boolean | ((config: InternalRequestConfig) => boolean);
  readonly instrumentation?: InstrumentationConfig;
  readonly decompress: boolean;
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
  readonly data: string | Uint8Array | ArrayBuffer | Blob | FormData | ReadableStream<Uint8Array> | null;
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

export interface RetryAttempt { readonly attempt: number; readonly duration: number; readonly success: boolean; readonly error?: string }
export interface RetryEvent { readonly attempt: number; readonly delay: number; readonly error: Error; readonly context: RetryContext }
export interface RetryContext { readonly url?: string; readonly method?: HttpMethod }
export interface ConcurrentOptions { readonly limit?: number; readonly failFast?: boolean; readonly timeout?: number; readonly onProgress?: (done: number, total: number, index: number, error: Error | null) => void }
export interface ConcurrentResult<TData extends ParsedResponseData = ParsedResponseData> { readonly results: Array<NeutrxResponse<TData> | null>; readonly errors: Array<Error | null>; readonly completed: number }
export interface PaginationOptions { readonly pageParam?: string; readonly limitParam?: string; readonly pageSize?: number; readonly dataPath?: string; readonly hasMorePath?: string; readonly maxPages?: number }
export interface PaginationPage<TData extends ParsedResponseData = ParsedResponseData> { readonly data: TData; readonly page: number; readonly response: NeutrxResponse }
export interface OAuth2Config { readonly tokenURL: string; readonly clientId?: string; readonly clientSecret?: string; readonly scope?: string; readonly grantType?: string }
export interface GraphQLResult<TData extends JsonValue = JsonValue> extends NeutrxResponse<TData | null> { readonly extensions?: JsonValue }
export interface MockResponse<TData extends ParsedResponseData = ParsedResponseData> { readonly status?: number; readonly statusText?: string; readonly headers?: Headers; readonly data?: TData; readonly delay?: number }
export interface MockController { enable(): MockController; disable(): MockController; clear(): MockController; register<TData extends ParsedResponseData>(urlPattern: string | RegExp, response: MockResponse<TData>): MockController }
export interface SseHandle { close(): void }
export interface AuthConfig { readonly bearer?: string; readonly basic?: { readonly username: string; readonly password: string }; readonly apiKey?: { readonly key: string; readonly header?: string } }
export interface CacheStats { readonly hits: number; readonly misses: number; readonly evictions: number; readonly sets: number; readonly size: number; readonly maxSize: number; readonly hitRate: string }
export interface CircuitStatus { readonly state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; readonly failures?: number; readonly successCount?: number; readonly active?: number; readonly openedAt?: number | null; readonly lastFailure?: number | null }
export interface BulkheadStats { readonly domains: Record<string, { readonly active: number; readonly queued: number }> }
export class NeutrxHeaders {
  constructor(init?: Headers | NeutrxHeaders | Iterable<readonly [string, HeaderValue | string]>);
  static from(init?: Headers | NeutrxHeaders | Iterable<readonly [string, HeaderValue | string]>): NeutrxHeaders;
  static concat(...sources: readonly (Headers | NeutrxHeaders | Iterable<readonly [string, HeaderValue | string]> | undefined)[]): NeutrxHeaders;
  set(name: string, value: HeaderValue): this;
  get(name: string): HeaderValue | undefined;
  has(name: string): boolean;
  delete(name: string): boolean;
  clear(): this;
  normalize(): this;
  concat(...sources: readonly (Headers | NeutrxHeaders | Iterable<readonly [string, HeaderValue | string]> | undefined)[]): NeutrxHeaders;
  toJSON(): Headers;
  getSetCookie(): string[];
  setContentType(value: string): this;
  getContentType(): string | undefined;
  setAccept(value: string): this;
  setAuthorization(value: string): this;
  setBearerAuth(token: string): this;
  removeAuthorization(): this;
  redactSensitive(redaction?: string): Headers;
}
export interface AxiosInterceptorManager<TValue> { use(onFulfilled?: (value: TValue) => TValue | Promise<TValue>, onRejected?: (error: Error) => TValue | Error | Promise<TValue | Error>, options?: { readonly synchronous?: boolean; readonly runWhen?: (config: InternalRequestConfig) => boolean }): number; eject(id: number): void; clear(): void }
export interface AxiosInterceptors { readonly request: AxiosInterceptorManager<InternalRequestConfig>; readonly response: AxiosInterceptorManager<NeutrxResponse> }
export interface NeutrxPlugin { readonly name: string; readonly version?: string; install?(client: NeutrxInstance, api: { addHook(name: 'beforeRequest', fn: (context: InternalRequestConfig) => InternalRequestConfig | Promise<InternalRequestConfig>): void; addHook(name: 'afterRequest', fn: (context: NeutrxResponse) => NeutrxResponse | Promise<NeutrxResponse>): void; addHook(name: 'onError', fn: (context: Error) => Error | Promise<Error>): void; addInterceptor: NeutrxInstance['useRequest'] }): void; uninstall?(client: NeutrxInstance): void }

export class NeutrxError extends Error { readonly __isNeutrxError: true; code: string; timestamp: string; requestId: string | null; url: string | null; method: string | null; retryable: boolean; duration?: number; toJSON(): Record<string, unknown> }
export class NeutrxNetworkError extends NeutrxError {}
export class NeutrxConnectionRefusedError extends NeutrxNetworkError {}
export class NeutrxDNSError extends NeutrxNetworkError {}
export class NeutrxTimeoutError extends NeutrxError {}
export class NeutrxConnectTimeoutError extends NeutrxTimeoutError {}
export class NeutrxResponseTimeoutError extends NeutrxTimeoutError {}
export class NeutrxSecurityError extends NeutrxError {}
export class NeutrxSSRFError extends NeutrxSecurityError {}
export class NeutrxCertPinError extends NeutrxSecurityError {}
export class NeutrxInjectionError extends NeutrxSecurityError {}
export class NeutrxPrototypePollutionError extends NeutrxSecurityError {}
export class NeutrxRateLimitError extends NeutrxSecurityError {}
export class NeutrxHTTPError extends NeutrxError {}
export class NeutrxClientError extends NeutrxHTTPError {}
export class NeutrxServerError extends NeutrxHTTPError {}
export class NeutrxCircuitBreakerError extends NeutrxError {}
export class NeutrxMaxRetriesError extends NeutrxError {}
export class NeutrxBulkheadError extends NeutrxError {}
export class NeutrxResponseSizeError extends NeutrxError {}
export class NeutrxRequestSizeError extends NeutrxError {}
export function isNeutrxError(error: unknown): error is NeutrxError;

type CallableRequestConfig<TBody extends RequestBody = RequestBody> = Omit<RequestConfig<TBody>, 'url'>;
export interface NeutrxInstance {
  <TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(config: RequestConfig<TBody>): Promise<NeutrxResponse<TData>>;
  <TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(url: string, config?: CallableRequestConfig<TBody>): Promise<NeutrxResponse<TData>>;
  readonly interceptors: AxiosInterceptors;
  configureOAuth2?: (config: OAuth2Config) => void;
  gql?: <TData extends JsonValue = JsonValue>(endpoint: string, query: string, variables?: Record<string, JsonValue>, options?: { readonly operationName?: string; readonly headers?: Headers }) => Promise<GraphQLResult<TData>>;
  mock?: MockController;
  get<TData extends ParsedResponseData = ParsedResponseData>(url: string, config?: CallableRequestConfig): Promise<NeutrxResponse<TData>>;
  post<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(url: string, data: TBody, config?: CallableRequestConfig<TBody>): Promise<NeutrxResponse<TData>>;
  postForm<TData extends ParsedResponseData = ParsedResponseData>(url: string, data: RequestBody, config?: CallableRequestConfig): Promise<NeutrxResponse<TData>>;
  put<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(url: string, data: TBody, config?: CallableRequestConfig<TBody>): Promise<NeutrxResponse<TData>>;
  putForm<TData extends ParsedResponseData = ParsedResponseData>(url: string, data: RequestBody, config?: CallableRequestConfig): Promise<NeutrxResponse<TData>>;
  patch<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(url: string, data: TBody, config?: CallableRequestConfig<TBody>): Promise<NeutrxResponse<TData>>;
  patchForm<TData extends ParsedResponseData = ParsedResponseData>(url: string, data: RequestBody, config?: CallableRequestConfig): Promise<NeutrxResponse<TData>>;
  delete<TData extends ParsedResponseData = ParsedResponseData>(url: string, config?: CallableRequestConfig): Promise<NeutrxResponse<TData>>;
  head<TData extends ParsedResponseData = ParsedResponseData>(url: string, config?: CallableRequestConfig): Promise<NeutrxResponse<TData>>;
  options<TData extends ParsedResponseData = ParsedResponseData>(url: string, config?: CallableRequestConfig): Promise<NeutrxResponse<TData>>;
  request<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(config: RequestConfig<TBody>): Promise<NeutrxResponse<TData>>;
  create(config?: ClientConfig): NeutrxInstance;
  setBaseURL(url: string): this;
  setTimeout(ms: number): this;
  setHeader(key: string, value: HeaderValue): this;
  removeHeader(key: string): this;
  setAuth(auth: AuthConfig): this;
  clearAuth(): this;
  clearCache(pattern?: string): this;
  resetMetrics(): this;
  useRequest(onFulfilled?: (config: InternalRequestConfig) => InternalRequestConfig | Promise<InternalRequestConfig>, onRejected?: (error: Error) => InternalRequestConfig | Promise<InternalRequestConfig>, options?: { readonly synchronous?: boolean; readonly runWhen?: (config: InternalRequestConfig) => boolean }): number;
  useResponse(onFulfilled?: (response: NeutrxResponse) => NeutrxResponse | Promise<NeutrxResponse>, onRejected?: (error: Error) => NeutrxResponse | Error | Promise<NeutrxResponse | Error>): number;
  eject(id: number): this;
  use(plugin: NeutrxPlugin): this;
  getUri(config: string | RequestConfig): string;
  getCacheStats(): CacheStats;
  getCircuitStatus(url?: string): CircuitStatus | Record<string, CircuitStatus>;
  getBulkheadStats(): BulkheadStats;
  destroy(): void;
}
export type NeutrxStatic = NeutrxInstance;
export declare const OAuth2Plugin: NeutrxPlugin;
export declare const GraphQLPlugin: NeutrxPlugin;
export declare const MockPlugin: NeutrxPlugin;
export declare const STRATEGY: Readonly<{ readonly FIXED: 'fixed'; readonly LINEAR: 'linear'; readonly EXPONENTIAL: 'exponential'; readonly FIBONACCI: 'fibonacci' }>;
export declare const VERSION: string;
declare const Neutrx: NeutrxStatic;
export { Neutrx };
export default Neutrx;
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${contents.trim()}\n`, "utf8");
console.log(`Generated browser-safe types at ${path.relative(rootDir, output)}`);
