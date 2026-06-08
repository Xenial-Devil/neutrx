import InterceptorChain, { type NeutrxInterceptors } from '../interceptors/InterceptorChain.js';
import { PluginManager, type NeutrxPlugin } from '../plugins/PluginManager.js';
import CircuitBreaker from '../resilience/CircuitBreaker.js';
import { RetryEngine } from '../resilience/RetryEngine.js';
import Bulkhead from '../resilience/Bulkhead.js';
import Deduplicator from '../performance/Deduplicator.js';
import { normalizeCacheStrategy } from '../performance/cacheStrategy.js';
import { normalizeSecurityProfile } from '../security/profiles.js';
import {
    NeutrxErrorFactory,
    NeutrxResponseSizeError,
    NeutrxResponseTimeoutError,
    NeutrxSecurityError,
    axiosTimeoutErrorCode,
    isNeutrxError,
} from './NeutrxError.js';
import { abortError, abortReason, mergeCancellationSignal } from './cancel.js';
import { resolveServiceEndpoint, type ServiceDiscoveryState } from './config.js';
import { createMutableDefaults, defaultsToConfig, type NeutrxDefaults } from './defaults.js';
import { NeutrxHeaders, assertHeadersSafe, getHeader, hasHeader, headerToString, normalizeRequestHeaders } from './headers.js';
import { validateResponseData } from './validation.js';
import { createNativeWebSocketConnection, webSocketRequestConfig, webSocketUrl } from './websocket.js';
import type {
    AuthConfig,
    BulkheadStats,
    CacheStats,
    CircuitStatus,
    ClientConfig,
    ConcurrentOptions,
    ConcurrentResult,
    EgressPolicyAudit,
    FetchCredentials,
    GraphQLResult,
    HeaderSource,
    Headers,
    HttpMethod,
    InternalHeaders,
    InstrumentationConfig,
    InternalRequestConfig,
    JsonValue,
    MockController,
    NeutrxWebSocketData,
    NeutrxWebSocketMessage,
    NeutrxLogger,
    NeutrxResponse,
    NeutrxWebSocketOptions,
    NeutrxWSConnection,
    NormalizedClientConfig,
    OAuth2Config,
    ParseJson,
    PaginationOptions,
    PaginationPage,
    ParsedResponseData,
    ProgressEvent,
    QueryParams,
    QueryValue,
    RawHttpResponse,
    RequestBody,
    RequestConfig,
    ResponseSchemaOption,
    RetryContext,
    ResponseType,
    SchemaResponseData,
    SseHandle,
    TransformRequest,
    TransformResponse,
    ValidationPluginConfig,
    CacheRevalidateReason,
    CacheStrategy,
} from '../types.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_URL_LENGTH = 2048;
const MAX_OBJECT_DEPTH = 10;

type BodylessRequestConfig<TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined> = Omit<RequestConfig<RequestBody, TSchema>, 'url' | 'method' | 'data'>;
type BodyRequestConfig<
    TBody extends RequestBody,
    TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
> = Omit<RequestConfig<TBody, TSchema>, 'url' | 'method' | 'data'>;
type RuntimeRequestConfig = InternalRequestConfig & { headers: InternalHeaders };
type BeforeRequestResult = Omit<InternalRequestConfig, 'headers'> & { readonly headers: HeaderSource };
type BrowserListener = (payload: unknown) => void;
type FetchInit = RequestInit & { duplex?: 'half' };
type FetchBody = NonNullable<RequestInit['body']>;
type BrowserRequestMetrics = { total: number; active: number; success: number; errors: number; cached: number; retried: number; deduplicated: number };
type BrowserErrorMetrics = { byType: Record<string, number>; byCode: Record<string, number>; byCategory: Record<string, number> };
type BrowserMetricsSnapshot = {
    readonly requests: BrowserRequestMetrics;
    readonly performance: { readonly min: number; readonly max: number; readonly avg: number; readonly total: number; readonly p50: number; readonly p90: number; readonly p95: number; readonly p99: number };
    readonly byStatus: Record<string, number>;
    readonly byEndpoint: Record<string, never>;
    readonly errors: BrowserErrorMetrics;
    readonly summary: { readonly total: number; readonly successRate: string; readonly errorRate: string; readonly cacheRate: string; readonly deduplicationRate: string; readonly avgDuration: string; readonly p99: string };
};
type BrowserGlobal = typeof globalThis & {
    readonly location?: { readonly href: string; readonly origin: string };
    readonly document?: { readonly cookie: string };
    readonly window?: unknown;
};

class TinyEmitter {
    #events = new Map<string, Set<BrowserListener>>();

    on(event: string, listener: BrowserListener): this {
        const listeners = this.#events.get(event) ?? new Set<BrowserListener>();
        listeners.add(listener);
        this.#events.set(event, listeners);
        return this;
    }

    off(event: string, listener: BrowserListener): this {
        this.#events.get(event)?.delete(listener);
        return this;
    }

    emit(event: string, payload: unknown): boolean {
        const listeners = this.#events.get(event);
        if (!listeners?.size) return false;
        listeners.forEach(listener => listener(payload));
        return true;
    }

    removeAllListeners(): this {
        this.#events.clear();
        return this;
    }
}

export default class BrowserClient extends TinyEmitter {
    configureOAuth2?: (config: OAuth2Config) => void;
    configureValidation?: (config: ValidationPluginConfig) => void;
    gql?: <TData extends JsonValue = JsonValue>(
        endpoint: string,
        query: string,
        variables?: Record<string, JsonValue>,
        options?: { readonly operationName?: string; readonly headers?: HeaderSource }
    ) => Promise<GraphQLResult<TData>>;
    mock?: MockController;
    logger: NeutrxLogger | undefined = undefined;
    readonly defaults: NeutrxDefaults;
    readonly interceptors: NeutrxInterceptors;

    #config: NormalizedClientConfig;
    #interceptors = new InterceptorChain();
    #circuitBreaker: CircuitBreaker;
    #retryEngine: RetryEngine;
    #bulkhead: Bulkhead;
    #cache: BrowserCache;
    #deduplicator: Deduplicator;
    #metrics = new BrowserMetrics();
    #plugins: PluginManager;
    #defaultHeaders: InternalHeaders;
    #serviceDiscovery: ServiceDiscoveryState = { counters: new Map<string, number>() };

    constructor(config: ClientConfig = {}) {
        super();
        this.#config = this.#buildConfig(config);
        this.defaults = createMutableDefaults(this.#config);
        this.#circuitBreaker = new CircuitBreaker(this.#config.resilience);
        this.#retryEngine = new RetryEngine(this.#config.resilience);
        this.#bulkhead = new Bulkhead(this.#config.resilience);
        this.#cache = new BrowserCache(this.#config.performance);
        this.#deduplicator = new Deduplicator(this.#config.performance);
        this.#plugins = new PluginManager(this as never);
        this.#defaultHeaders = this.#buildDefaultHeaders();
        this.interceptors = this.#interceptors.managers();
    }

    get<TData extends ParsedResponseData = ParsedResponseData, TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
        url: string,
        config: BodylessRequestConfig<TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, RequestBody, TSchema>({ ...config, method: 'GET', url });
    }

    post<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, TBody, TSchema>({ ...config, method: 'POST', url, data });
    }

    postForm<TData extends ParsedResponseData = ParsedResponseData, TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
        url: string,
        data: RequestBody,
        config: BodyRequestConfig<RequestBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, RequestBody, TSchema>({ ...config, method: 'POST', url, data: toFormBody(data) });
    }

    postUrlEncoded<TData extends ParsedResponseData = ParsedResponseData, TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
        url: string,
        data: RequestBody,
        config: BodyRequestConfig<RequestBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, RequestBody, TSchema>({ ...withUrlEncodedHeaders(config), method: 'POST', url, data });
    }

    put<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, TBody, TSchema>({ ...config, method: 'PUT', url, data });
    }

    putForm<TData extends ParsedResponseData = ParsedResponseData, TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
        url: string,
        data: RequestBody,
        config: BodyRequestConfig<RequestBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, RequestBody, TSchema>({ ...config, method: 'PUT', url, data: toFormBody(data) });
    }

    putUrlEncoded<TData extends ParsedResponseData = ParsedResponseData, TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
        url: string,
        data: RequestBody,
        config: BodyRequestConfig<RequestBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, RequestBody, TSchema>({ ...withUrlEncodedHeaders(config), method: 'PUT', url, data });
    }

    patch<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, TBody, TSchema>({ ...config, method: 'PATCH', url, data });
    }

    patchForm<TData extends ParsedResponseData = ParsedResponseData, TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
        url: string,
        data: RequestBody,
        config: BodyRequestConfig<RequestBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, RequestBody, TSchema>({ ...config, method: 'PATCH', url, data: toFormBody(data) });
    }

    patchUrlEncoded<TData extends ParsedResponseData = ParsedResponseData, TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
        url: string,
        data: RequestBody,
        config: BodyRequestConfig<RequestBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, RequestBody, TSchema>({ ...withUrlEncodedHeaders(config), method: 'PATCH', url, data });
    }

    delete<TData extends ParsedResponseData = ParsedResponseData, TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
        url: string,
        config: BodylessRequestConfig<TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, RequestBody, TSchema>({ ...config, method: 'DELETE', url });
    }

    head<TData extends ParsedResponseData = ParsedResponseData, TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
        url: string,
        config: BodylessRequestConfig<TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, RequestBody, TSchema>({ ...config, method: 'HEAD', url });
    }

    options<TData extends ParsedResponseData = ParsedResponseData, TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
        url: string,
        config: BodylessRequestConfig<TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, RequestBody, TSchema>({ ...config, method: 'OPTIONS', url });
    }

    async concurrent<TData extends ParsedResponseData = ParsedResponseData>(
        requests: readonly (RequestConfig | (() => RequestConfig))[],
        options: ConcurrentOptions = {}
    ): Promise<ConcurrentResult<TData>> {
        const { limit = 10, failFast = false, timeout = 60_000, onProgress } = options;
        const results: Array<NeutrxResponse<TData> | null> = Array.from({ length: requests.length }, (): NeutrxResponse<TData> | null => null);
        const errors: Array<Error | null> = Array.from({ length: requests.length }, (): Error | null => null);
        const queue = requests.map((request, index) => ({ request, index }));
        let completed = 0;

        const done = (index: number, result: NeutrxResponse<TData> | null, error: Error | null): void => {
            results[index] = result;
            errors[index] = error;
            completed += 1;
            onProgress?.(completed, requests.length, index, error);
        };

        const worker = async (): Promise<void> => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) continue;
                const cfg = typeof item.request === 'function' ? item.request() : item.request;
                try {
                    done(item.index, await this.request<TData>(cfg), null);
                } catch (error: unknown) {
                    const normalized = normalizeError(error);
                    done(item.index, null, normalized);
                    if (failFast) {
                        queue.length = 0;
                        throw normalized;
                    }
                }
            }
        };

        const workers = Array.from({ length: Math.min(limit, requests.length) }, () => worker());
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('concurrent timeout')), timeout);
        });

        try {
            await Promise.race([Promise.all(workers), timeoutPromise]);
        } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
        }
        return { results, errors, completed };
    }

    async sequential<TData extends ParsedResponseData = ParsedResponseData>(
        requests: readonly (RequestConfig | ((previous: NeutrxResponse<TData> | null, results: readonly NeutrxResponse<TData>[]) => RequestConfig))[]
    ): Promise<NeutrxResponse<TData>[]> {
        const results: NeutrxResponse<TData>[] = [];
        for (const request of requests) {
            const cfg = typeof request === 'function' ? request(results.at(-1) ?? null, results) : request;
            results.push(await this.request<TData>(cfg));
        }
        return results;
    }

    race<TData extends ParsedResponseData = ParsedResponseData>(requests: readonly (RequestConfig | (() => RequestConfig))[]): Promise<NeutrxResponse<TData>> {
        return Promise.race(requests.map(request => this.request<TData>(typeof request === 'function' ? request() : request)));
    }

    async hedged<TData extends ParsedResponseData = ParsedResponseData>(
        requests: readonly (RequestConfig | (() => RequestConfig))[],
        { delay = 500 }: { readonly delay?: number } = {}
    ): Promise<NeutrxResponse<TData>> {
        const controllers = requests.map(() => new AbortController());
        const promises = requests.map((request, index) => (async (): Promise<{ readonly result: NeutrxResponse<TData>; readonly index: number }> => {
            if (index > 0) await sleep(delay * index);
            const cfg = typeof request === 'function' ? request() : request;
            const signal = controllers[index]?.signal;
            const requestConfig = signal ? { ...cfg, signal } : cfg;
            return { result: await this.request<TData>(requestConfig), index };
        })());

        const { result, index } = await Promise.race(promises);
        controllers.forEach((controller, controllerIndex) => {
            if (controllerIndex !== index) controller.abort();
        });
        return result;
    }

    async *paginate<TData extends ParsedResponseData = ParsedResponseData>(
        url: string,
        options: PaginationOptions = {}
    ): AsyncGenerator<PaginationPage<TData>> {
        const {
            pageParam = 'page',
            limitParam = 'limit',
            pageSize = 20,
            dataPath = 'data',
            hasMorePath = 'hasMore',
            maxPages = Number.POSITIVE_INFINITY,
        } = options;

        let page = 1;
        let hasMore = true;

        while (hasMore && page <= maxPages) {
            const response = await this.get(url, { params: { [pageParam]: page, [limitParam]: pageSize } });
            hasMore = Boolean(dig(response.data, hasMorePath));
            yield { data: dig(response.data, dataPath) as TData, page, response };
            page += 1;
        }
    }

    upload<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.request<TData, TBody, TSchema>({ ...config, method: 'POST', url, data });
    }

    download<TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
        url: string,
        config: BodylessRequestConfig<TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<ArrayBuffer, TSchema>>> {
        return this.request<ArrayBuffer, RequestBody, TSchema>({ ...config, method: 'GET', url, responseType: 'buffer' });
    }

    sse(url: string, { onMessage, onError, onClose }: {
        readonly onMessage?: (message: JsonValue | string) => void;
        readonly onError?: (error: Error) => void;
        readonly onClose?: () => void;
    } = {}): Promise<SseHandle> {
        if (typeof EventSource === 'undefined') {
            throw new NeutrxSecurityError('SSE requires EventSource in this runtime', { code: 'EVENTSOURCE_UNAVAILABLE' });
        }

        const source = new EventSource(this.#buildURL({ url }));
        source.onmessage = (event: MessageEvent): void => {
            const eventData: unknown = (event as { readonly data?: unknown }).data;
            const data = typeof eventData === 'string' ? eventData : '';
            try {
                const parsed = JSON.parse(data) as JsonValue;
                onMessage?.(parsed);
            } catch {
                onMessage?.(data);
            }
        };
        source.onerror = () => onError?.(new Error('SSE connection error'));
        source.addEventListener('close', () => onClose?.());
        return Promise.resolve({ close: () => source.close() });
    }

    async ws<
        TMessage = NeutrxWebSocketData,
        TSend extends NeutrxWebSocketMessage = NeutrxWebSocketMessage
    >(
        url: string,
        options: NeutrxWebSocketOptions<TMessage, TSend> = {}
    ): Promise<NeutrxWSConnection<TMessage, TSend>> {
        const config = await this.#buildWebSocketRC(url, options);
        return createNativeWebSocketConnection<TMessage, TSend>(config.url, options);
    }

    async request<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        config: RequestConfig<TBody, TSchema>
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        const requestId = this.#id();
        const t0 = Date.now();
        let trackedUrl = config.url;
        let circuitChecked = false;
        let cacheConfig: InternalRequestConfig | null = null;
        let traceContext = undefined as InternalRequestConfig['traceContext'];
        let trackedMethod = typeof config.method === 'string' ? config.method.toUpperCase() : 'GET';
        this.#metrics.recordStart();

        try {
            let rc: InternalRequestConfig = await this.#buildRC(config, requestId);
            trackedUrl = rc.url;

            rc = toInternalRequestConfig(await this.#plugins.runHook('beforeRequest', rc));
            traceContext = rc.traceContext;
            trackedMethod = rc.method;
            if (rc.mockResponse) return rc.mockResponse as NeutrxResponse<SchemaResponseData<TData, TSchema>>;

            rc = toInternalRequestConfig(this.#validateRequest(rc));
            rc = toInternalRequestConfig(await this.#interceptors.runRequest(rc));
            rc = toInternalRequestConfig(this.#validateRequest(rc));
            trackedUrl = rc.url;

            if (rc.method === 'GET' && rc.cache !== false) {
                cacheConfig = rc;
                if (!this.#cache.usesNetworkFirst()) {
                    const hit = this.#cache.getWithState(rc);
                    if (hit) {
                        this.#metrics.recordCacheHit();
                        this.emit('cache:hit', { requestId, url: rc.url, state: hit.state });
                        if (hit.state === 'stale') this.#revalidateCache(rc, 'stale');
                        return hit.response as NeutrxResponse<SchemaResponseData<TData, TSchema>>;
                    }
                }
            }

            await this.#circuitBreaker.canRequest(rc.url);
            circuitChecked = true;

            const domain = this.#domain(rc.url);
            const retryContext: RetryContext = {
                url: rc.url,
                method: rc.method,
                deadlineAt: rc.startTime + rc.timeout,
                ...(rc.idempotencyKey ? { idempotencyKey: rc.idempotencyKey } : {}),
                ...(rc.signal ? { signal: rc.signal } : {}),
            };
            const { result: response, attempts } = await this.#retryEngine.execute(
                async (attempt): Promise<NeutrxResponse<TData>> => {
                    if (attempt > 0) this.#metrics.recordRetry();
                    const raw = await this.#bulkhead.execute(domain, () => this.#dispatchDeduped(rc));
                    return this.#parse<TData>(raw, rc);
                },
                retryContext
            );

            response.attempts = attempts;
            let next: NeutrxResponse = this.#sanitizeResponse(response);
            next = await this.#interceptors.runResponse(next);
            next = await this.#plugins.runHook('afterRequest', next);

            if (rc.method === 'GET' && rc.cache !== false) this.#cache.set(rc, next);

            const duration = Date.now() - t0;
            this.#metrics.recordSuccess(rc.url, duration, next.status);
            await this.#circuitBreaker.recordSuccess(rc.url);
            this.emit('request:success', {
                requestId,
                url: rc.url,
                method: rc.method,
                status: next.status,
                duration,
                attempts: attempts.length,
            });

            return next as NeutrxResponse<SchemaResponseData<TData, TSchema>>;
        } catch (error: unknown) {
            const normalized = normalizeError(error) as Error & { requestId?: string; duration?: number; code?: string };
            normalized.requestId = requestId;
            normalized.duration = Date.now() - t0;
            if (isNeutrxError(normalized)) {
                if (!normalized.traceContext && traceContext) normalized.traceContext = traceContext;
                normalized.url ??= trackedUrl;
                normalized.method ??= trackedMethod;
            }

            if (cacheConfig) {
                const fallback = this.#cache.getNetworkFallback(cacheConfig);
                if (fallback) {
                    this.#metrics.recordCacheHit();
                    this.emit('cache:fallback', { requestId, url: cacheConfig.url, error: normalized });
                    return fallback as NeutrxResponse<SchemaResponseData<TData, TSchema>>;
                }
            }

            this.#metrics.recordError(trackedUrl, normalized);
            if (circuitChecked) await this.#circuitBreaker.recordFailure(trackedUrl);

            this.emit('request:error', { requestId, url: trackedUrl, error: normalized, duration: normalized.duration });
            await this.#plugins.runHook('onError', normalized);

            const handled = await this.#interceptors.runError(normalized);
            if (handled instanceof Error) throw handled;
            return handled as NeutrxResponse<SchemaResponseData<TData, TSchema>>;
        } finally {
            this.#metrics.recordEnd();
        }
    }

    setBaseURL(url: string): this {
        this.#validateURL(url);
        this.#config = { ...this.#config, baseURL: url };
        this.defaults.baseURL = url;
        return this;
    }

    setTimeout(ms: number): this {
        this.#config = { ...this.#config, timeout: ms };
        this.defaults.timeout = ms;
        return this;
    }

    clearAuth(): this {
        this.#defaultHeaders.delete('Authorization');
        return this;
    }

    clearCache(pattern?: string | RegExp): this {
        this.#cache.clear(pattern);
        return this;
    }

    invalidateCache(pattern?: string | RegExp): this {
        this.#cache.invalidate(pattern);
        return this;
    }

    deleteCacheEntry(config: string | RequestConfig): this {
        const url = this.getUri(typeof config === 'string' ? { url: config } : config);
        this.#cache.deleteByUrl(url);
        return this;
    }

    resetMetrics(): this {
        this.#metrics.reset();
        return this;
    }

    setHeader(key: string, value: Headers[string]): this {
        this.#validateHeaders({ [key]: value });
        this.#defaultHeaders.set(key, value);
        return this;
    }

    removeHeader(key: string): this {
        this.#defaultHeaders.delete(key);
        return this;
    }

    setAuth(auth: AuthConfig): this {
        if (auth.bearer) {
            this.#defaultHeaders.setBearerAuth(auth.bearer);
        } else if (auth.basic) {
            this.#defaultHeaders.setAuthorization(`Basic ${base64(`${auth.basic.username}:${auth.basic.password}`)}`);
        } else if (auth.apiKey) {
            this.#defaultHeaders.set(auth.apiKey.header ?? 'X-Api-Key', auth.apiKey.key);
        }
        return this;
    }

    useRequest(
        onFulfilled?: Parameters<InterceptorChain['addRequest']>[0],
        onRejected?: Parameters<InterceptorChain['addRequest']>[1],
        options?: Parameters<InterceptorChain['addRequest']>[2]
    ): number {
        return this.#interceptors.addRequest(onFulfilled, onRejected, options);
    }

    useResponse(onFulfilled?: Parameters<InterceptorChain['addResponse']>[0], onRejected?: Parameters<InterceptorChain['addResponse']>[1]): number {
        return this.#interceptors.addResponse(onFulfilled, onRejected);
    }

    eject(id: number): this {
        this.#interceptors.remove(id);
        return this;
    }

    pinCertificate(): this {
        throw new NeutrxSecurityError('Certificate pinning is Node-only', { code: 'NODE_ONLY_FEATURE' });
    }

    blockDomain(domain: string): this {
        this.#cache.block(domain);
        return this;
    }

    enableRequestSigning(): this {
        throw new NeutrxSecurityError('Request signing is Node-only unless a Web Crypto signer is provided', { code: 'NODE_ONLY_FEATURE' });
    }

    setLogger(logger: NeutrxLogger | undefined): this {
        this.logger = logger;
        return this;
    }

    enableOpenTelemetry(config: InstrumentationConfig = {}): this {
        const instrumentation = {
            ...this.#config.instrumentation,
            openTelemetry: true,
            propagateTraceHeaders: true,
            ...config,
        };
        this.#config = {
            ...this.#config,
            instrumentation,
        };
        this.defaults.instrumentation = instrumentation;
        return this;
    }

    use(plugin: NeutrxPlugin): this {
        this.#plugins.use(plugin);
        return this;
    }

    addPluginHook(name: 'beforeRequest', hook: (context: InternalRequestConfig) => BeforeRequestResult | Promise<BeforeRequestResult>): void;
    addPluginHook(name: 'afterRequest', hook: (context: NeutrxResponse) => NeutrxResponse | Promise<NeutrxResponse>): void;
    addPluginHook(name: 'onError', hook: (context: Error) => Error | Promise<Error>): void;
    addPluginHook(
        name: 'beforeRequest' | 'afterRequest' | 'onError',
        hook:
            | ((context: InternalRequestConfig) => BeforeRequestResult | Promise<BeforeRequestResult>)
            | ((context: NeutrxResponse) => NeutrxResponse | Promise<NeutrxResponse>)
            | ((context: Error) => Error | Promise<Error>)
    ): void {
        this.#plugins.addHook(name, hook);
    }

    getMetrics(): ReturnType<BrowserMetrics['getAll']> {
        return this.#metrics.getAll();
    }

    getMetricsPrometheus(): string {
        return this.#metrics.toPrometheus();
    }

    getCacheStats(): CacheStats {
        return this.#cache.getStats();
    }

    getCircuitStatus(url?: string): CircuitStatus | Record<string, CircuitStatus> {
        return this.#circuitBreaker.getStatus(url);
    }

    getBulkheadStats(): BulkheadStats {
        return this.#bulkhead.getStats();
    }

    getEgressPolicy(): EgressPolicyAudit {
        return egressPolicyAudit(this.#config.egressPolicy);
    }

    getUri(config: string | RequestConfig): string {
        const requestConfig = typeof config === 'string' ? { url: config } : config;
        return this.#buildURL(requestConfig, this.#configWithDefaults(requestConfig.method));
    }

    create(config: ClientConfig = {}): BrowserClient {
        return new BrowserClient(mergeConfig(this.#configWithDefaults(), config));
    }

    destroy(): void {
        this.#deduplicator.clear();
        this.#cache.destroy();
        this.#metrics.destroy();
        this.removeAllListeners();
    }

    async #dispatch(config: InternalRequestConfig): Promise<RawHttpResponse> {
        const adapter = config.adapter ?? this.#config.adapter ?? 'fetch';
        if (typeof adapter === 'function') return adapter(config);
        if (adapter !== 'fetch') {
            throw new NeutrxSecurityError('Browser runtimes support the fetch adapter only', { code: 'ADAPTER_UNAVAILABLE' });
        }
        return this.#fetch(config);
    }

    async #dispatchDeduped(config: InternalRequestConfig): Promise<RawHttpResponse> {
        const adapter = config.adapter ?? this.#config.adapter ?? 'fetch';
        return this.#deduplicator.dispatch(config, () => this.#dispatch(config), {
            adapterKey: typeof adapter === 'function' ? 'custom' : adapter,
            canUseDefaultKey: typeof adapter !== 'function',
            onHit: hit => {
                this.#metrics.recordDeduplicationHit();
                this.emit('request:deduplicated', {
                    requestId: hit.requestId,
                    url: hit.url,
                    method: hit.method,
                });
            },
        });
    }

    #revalidateCache(config: InternalRequestConfig, reason: CacheRevalidateReason): void {
        const strategy = this.#cache.strategy();
        if (!this.#cache.markRevalidating(config)) {
            this.#notifyRevalidate({
                requestId: config.requestId,
                url: config.url,
                strategy,
                reason,
                updated: false,
                skipped: true,
            });
            return;
        }

        const revalidationConfig = withoutSignal({
            ...config,
            requestId: this.#id(),
            startTime: Date.now(),
            cache: false,
        });

        void (async (): Promise<void> => {
            try {
                const raw = await this.#dispatchDeduped(revalidationConfig);
                const parsed = await this.#parse(raw, revalidationConfig);
                let next: NeutrxResponse = this.#sanitizeResponse(parsed);
                next = await this.#interceptors.runResponse(next);
                next = await this.#plugins.runHook('afterRequest', next);
                this.#cache.set(config, next);
                this.emit('cache:revalidated', { requestId: revalidationConfig.requestId, url: config.url, status: next.status });
                this.#notifyRevalidate({
                    requestId: revalidationConfig.requestId,
                    url: config.url,
                    strategy,
                    reason,
                    status: next.status,
                    updated: true,
                });
            } catch (error: unknown) {
                const normalized = normalizeError(error);
                this.emit('cache:revalidate:error', { requestId: revalidationConfig.requestId, url: config.url, error: normalized });
                this.#notifyRevalidate({
                    requestId: revalidationConfig.requestId,
                    url: config.url,
                    strategy,
                    reason,
                    updated: false,
                    error: normalized,
                });
            } finally {
                this.#cache.finishRevalidating(config);
            }
        })();
    }

    #notifyRevalidate(event: {
        readonly requestId: string;
        readonly url: string;
        readonly strategy: CacheStrategy;
        readonly reason: CacheRevalidateReason;
        readonly updated: boolean;
        readonly status?: number;
        readonly error?: Error;
        readonly skipped?: boolean;
    }): void {
        const callback = this.#config.performance.onRevalidate;
        if (!callback) return;
        void Promise.resolve(callback(event)).catch(error => {
            this.emit('cache:revalidate:error', {
                requestId: event.requestId,
                url: event.url,
                error: normalizeError(error),
            });
        });
    }

    async #fetch(config: InternalRequestConfig): Promise<RawHttpResponse> {
        const fetchImpl = config.fetch ?? globalThis.fetch;
        if (typeof fetchImpl !== 'function') {
            throw new NeutrxSecurityError('Fetch adapter requires globalThis.fetch', { code: 'FETCH_UNAVAILABLE' });
        }

        const runtimeConfig: RuntimeRequestConfig = { ...config, headers: normalizeRequestHeaders(config.headers) };
        const body = bodyless(runtimeConfig.method) ? undefined : toFetchBody(runtimeConfig);
        injectXsrfHeader(runtimeConfig);
        const headers = toFetchHeaders(runtimeConfig.headers);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new NeutrxResponseTimeoutError(runtimeConfig.url, runtimeConfig.timeout, {
            code: axiosTimeoutErrorCode(runtimeConfig.transitional),
        })), runtimeConfig.timeout);
        const abort = (): void => controller.abort(runtimeConfig.signal ? abortReason(runtimeConfig.signal) : undefined);
        if (runtimeConfig.signal?.aborted) {
            abort();
        } else {
            runtimeConfig.signal?.addEventListener('abort', abort, { once: true });
        }

        try {
            const init: FetchInit = {
                method: runtimeConfig.method,
                headers,
                signal: controller.signal,
                credentials: credentialsFor(runtimeConfig.withCredentials, runtimeConfig.credentials),
                ...(body !== undefined ? { body } : {}),
            };

            if (body !== undefined && isStreamLike(body)) init.duplex = 'half';

            const response = await fetchImpl(runtimeConfig.url, init);
            const total = contentLength(response.headers);
            const data = await readResponseData(response, runtimeConfig, total);

            return {
                status: response.status,
                statusText: response.statusText,
                headers: fromFetchHeaders(response.headers),
                data,
                config: runtimeConfig,
            } satisfies RawHttpResponse;
        } catch (error: unknown) {
            if (controller.signal.aborted) {
                throw abortError(controller.signal);
            }
            throw NeutrxErrorFactory.fromNodeError(normalizeError(error), runtimeConfig);
        } finally {
            clearTimeout(timeout);
            runtimeConfig.signal?.removeEventListener('abort', abort);
        }
    }

    async #parse<TData extends ParsedResponseData>(raw: RawHttpResponse, config: InternalRequestConfig): Promise<NeutrxResponse<TData>> {
        const parsed = parseResponseData(raw.data, config.responseType, raw.headers, config.responseEncoding, config.parseJson) as TData;
        const transformed = applyResponseTransforms(parsed, raw.headers, raw.status, config.transformResponse) as TData;
        const response: NeutrxResponse<TData> = {
            status: raw.status,
            statusText: raw.statusText,
            headers: raw.headers,
            data: transformed,
            config,
            ...(raw.request ? { request: raw.request } : {}),
            timing: { duration: Date.now() - config.startTime },
            requestId: config.requestId,
            ...(config.traceContext ? { traceContext: config.traceContext } : {}),
            ...(raw.deduplicated ? { deduplicated: true } : {}),
        };

        if (config.throwHttpErrors && !config.validateStatus(raw.status)) {
            throw NeutrxErrorFactory.fromHTTPStatus(response);
        }

        response.data = await validateResponseData(response.data, config);
        return response;
    }

    async #buildRC<TBody extends RequestBody>(config: RequestConfig<TBody>, requestId: string): Promise<InternalRequestConfig<TBody>> {
        const method = normalizeMethod(config.method ?? 'GET');
        const defaults = this.#configWithDefaults(method);
        const idempotencyKey = this.#resolveIdempotencyKey(config, requestId, defaults);
        const idempotencyKeyHeader = config.idempotencyKeyHeader ?? defaults.idempotencyKeyHeader ?? 'Idempotency-Key';
        const headers = this.#buildHeaders(config, defaults, requestId, idempotencyKey, idempotencyKeyHeader);
        const serviceEndpoint = await resolveServiceEndpoint(config, defaults, method, this.#serviceDiscovery);
        const urlConfig = serviceEndpoint ? { ...config, baseURL: serviceEndpoint.url } : config;
        const transformedData = applyRequestTransforms(
            config.data,
            headers,
            mergeTransformRequest(defaults.transformRequest, config.transformRequest)
        );
        const signal = mergeCancellationSignal(config.signal, config.cancelToken);

        if (transformedData !== undefined && !hasHeader(headers, 'Content-Type')) {
            const contentType = detectContentType(transformedData);
            if (contentType) headers.setContentType(contentType);
        }

        const xsrfCookieName = config.xsrfCookieName !== undefined
            ? config.xsrfCookieName
            : defaults.xsrfCookieName !== undefined ? defaults.xsrfCookieName : 'XSRF-TOKEN';
        const xsrfHeaderName = config.xsrfHeaderName !== undefined
            ? config.xsrfHeaderName
            : defaults.xsrfHeaderName !== undefined ? defaults.xsrfHeaderName : 'X-XSRF-TOKEN';
        const requestConfig = {
            ...config,
            url: this.#buildURL(urlConfig, defaults),
            method,
            headers,
            allowAbsoluteUrls: config.allowAbsoluteUrls ?? defaults.allowAbsoluteUrls,
            timeout: config.timeout ?? defaults.timeout,
            connectTimeout: config.connectTimeout ?? defaults.connectTimeout,
            maxRedirects: config.maxRedirects ?? defaults.maxRedirects,
            maxContentLength: config.maxContentLength ?? defaults.maxContentLength,
            maxBodyLength: config.maxBodyLength ?? defaults.maxBodyLength,
            responseType: config.responseType ?? 'json',
            responseEncoding: config.responseEncoding ?? defaults.responseEncoding,
            validateStatus: config.validateStatus ?? defaults.validateStatus,
            paramsSerializer: config.paramsSerializer ?? defaults.paramsSerializer,
            formSerializer: config.formSerializer ?? defaults.formSerializer,
            transformRequest: mergeTransformRequest(defaults.transformRequest, config.transformRequest),
            transformResponse: mergeTransformResponse(defaults.transformResponse, config.transformResponse),
            schema: config.schema === false ? false : config.schema ?? defaults.schema,
            parseJson: config.parseJson ?? defaults.parseJson,
            stringifyJson: config.stringifyJson ?? defaults.stringifyJson,
            throwHttpErrors: config.throwHttpErrors ?? defaults.throwHttpErrors,
            adapter: config.adapter ?? defaults.adapter,
            fetch: config.fetch ?? defaults.fetch,
            httpVersion: config.httpVersion ?? defaults.httpVersion,
            http2Options: config.http2Options ?? defaults.http2Options,
            serviceDiscovery: config.serviceDiscovery ?? defaults.serviceDiscovery,
            ...(serviceEndpoint ? { serviceEndpoint } : {}),
            withCredentials: config.withCredentials ?? defaults.withCredentials,
            credentials: config.credentials ?? defaults.credentials,
            xsrfCookieName,
            xsrfHeaderName,
            withXSRFToken: config.withXSRFToken ?? defaults.withXSRFToken,
            instrumentation: config.instrumentation ?? defaults.instrumentation,
            proxy: false,
            decompress: false,
            maxRate: config.maxRate ?? defaults.maxRate,
            transitional: { ...defaults.transitional, ...(config.transitional ?? {}) },
            followRedirects: config.followRedirects !== false,
            ...(signal ? { signal } : {}),
            requestId,
            startTime: Date.now(),
            hops: 0,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            ...(idempotencyKey ? { idempotencyKeyHeader } : {}),
        };

        delete (requestConfig as { auth?: unknown }).auth;
        if (transformedData === undefined) {
            delete (requestConfig as { data?: RequestBody }).data;
        } else {
            (requestConfig as { data?: RequestBody }).data = transformedData;
        }

        return requestConfig as InternalRequestConfig<TBody>;
    }

    async #buildWebSocketRC<TMessage, TSend extends NeutrxWebSocketMessage>(
        url: string,
        options: NeutrxWebSocketOptions<TMessage, TSend>
    ): Promise<InternalRequestConfig> {
        const defaults = this.#configWithDefaults('GET');
        let config = await this.#buildRC(webSocketRequestConfig(url, options, defaults.baseURL), this.#id());
        config = toInternalRequestConfig(await this.#plugins.runHook('beforeRequest', config));
        config = toInternalRequestConfig(this.#validateRequest(config));
        config = toInternalRequestConfig(await this.#interceptors.runRequest(config));
        config = toInternalRequestConfig(this.#validateRequest(config));
        return {
            ...config,
            url: webSocketUrl(config.url),
            headers: normalizeRequestHeaders(config.headers),
        };
    }

    #buildURL(config: RequestConfig, defaults: NormalizedClientConfig = this.#configWithDefaults(config.method)): string {
        let url = config.url;
        const isAbsoluteURL = /^https?:\/\//i.test(url);
        const allowAbsoluteUrls = config.allowAbsoluteUrls ?? defaults.allowAbsoluteUrls;
        if (!isAbsoluteURL || allowAbsoluteUrls === false) {
            const base = config.baseURL ?? defaults.baseURL ?? '';
            if (base) {
                url = `${base.endsWith('/') ? base.slice(0, -1) : base}${url.startsWith('/') ? url : `/${url}`}`;
            }
        }

        if (config.params && Object.keys(config.params).length > 0) {
            const serializer = config.paramsSerializer ?? defaults.paramsSerializer;
            const serialized = serializeParams(config.params, serializer);
            url = appendQueryString(url, serialized);
        }

        return url;
    }

    #buildHeaders<TBody extends RequestBody>(
        config: RequestConfig<TBody>,
        defaults: NormalizedClientConfig,
        requestId: string,
        idempotencyKey?: string,
        idempotencyKeyHeader = 'Idempotency-Key'
    ): InternalHeaders {
        const headers = NeutrxHeaders.concat(this.#defaultHeaders, defaults.headers, normalizeRequestHeaders(config.headers));
        headers.setIfNotBlocked('X-Request-ID', requestId);
        if (idempotencyKey) headers.setIfNotBlocked(idempotencyKeyHeader, idempotencyKey);
        const auth = config.auth ?? defaults.auth;
        if (auth) headers.setIfNotBlocked('Authorization', `Basic ${base64(`${auth.username}:${auth.password}`)}`);
        return normalizeRequestHeaders(headers);
    }

    #resolveIdempotencyKey<TBody extends RequestBody>(
        config: RequestConfig<TBody>,
        requestId: string,
        defaults: NormalizedClientConfig
    ): string | undefined {
        const key = config.idempotencyKey ?? defaults.idempotencyKey;
        if (key === undefined) return undefined;
        const resolved = key === true ? requestId : typeof key === 'function' ? key() : key;
        if (!resolved || /[\r\n]/.test(resolved)) {
            throw new NeutrxSecurityError('Invalid idempotency key', { code: 'INVALID_IDEMPOTENCY_KEY' });
        }
        return resolved;
    }

    #configWithDefaults(method?: HttpMethod | Lowercase<HttpMethod>): NormalizedClientConfig {
        return this.#buildConfig(mergeConfig(this.#config, defaultsToConfig(this.defaults, method, { rejectUnsafe: true })));
    }

    #buildDefaultHeaders(): InternalHeaders {
        return normalizeRequestHeaders({
            Accept: 'application/json, text/plain, */*',
        });
    }

    #validateRequest<TBody extends RequestBody>(config: InternalRequestConfig<TBody>): InternalRequestConfig<TBody> {
        this.#validateURL(config.url);
        this.#validateHeaders(config.headers);

        const domain = this.#domain(config.url).toLowerCase();
        if (this.#cache.isBlocked(domain)) {
            throw new NeutrxSecurityError(`Blocked domain: ${domain}`, { code: 'DOMAIN_BLOCKED' });
        }

        if (config.data !== undefined && this.#config.security.sanitizeInputs) {
            return { ...config, data: sanitizeBody(config.data) };
        }

        return config;
    }

    #sanitizeResponse<TData extends ParsedResponseData>(response: NeutrxResponse<TData>): NeutrxResponse<TData> {
        if (!this.#config.security.sanitizeOutputs) return response;
        if (typeof response.data === 'string') {
            response.data = sanitizeString(response.data) as TData;
            return response;
        }
        if (isJsonContainer(response.data)) response.data = sanitizeJson(response.data) as TData;
        return response;
    }

    #validateURL(url: string): URL {
        if (!url || typeof url !== 'string') throw new NeutrxSecurityError('URL must be a non-empty string', { code: 'INVALID_URL' });
        if (url.length > MAX_URL_LENGTH) throw new NeutrxSecurityError(`URL too long: ${url.length} > ${MAX_URL_LENGTH}`, { code: 'URL_TOO_LONG' });

        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw new NeutrxSecurityError(`Malformed URL: ${url}`, { code: 'MALFORMED_URL' });
        }

        if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
            throw new NeutrxSecurityError(`Unsupported protocol: ${parsed.protocol}`, { code: 'UNSUPPORTED_PROTOCOL' });
        }
        return parsed;
    }

    #validateHeaders(headers: Headers | NeutrxHeaders): void {
        assertHeadersSafe(headers);
    }

    #buildConfig(custom: ClientConfig): NormalizedClientConfig {
        const securityProfile = normalizeSecurityProfile(custom.security?.profile);
        const cacheTTL = custom.performance?.cacheTTL ?? 300_000;
        return {
            allowAbsoluteUrls: custom.allowAbsoluteUrls ?? true,
            timeout: custom.timeout ?? 30_000,
            connectTimeout: custom.connectTimeout ?? custom.timeout ?? 30_000,
            maxRedirects: custom.maxRedirects ?? 5,
            maxContentLength: custom.maxContentLength ?? 10 * 1024 * 1024,
            maxBodyLength: custom.maxBodyLength ?? 10 * 1024 * 1024,
            responseEncoding: custom.responseEncoding ?? 'utf8',
            validateStatus: custom.validateStatus ?? ((status): boolean => status >= 200 && status < 300),
            throwHttpErrors: custom.throwHttpErrors ?? true,
            decompress: false,
            ...(custom.maxRate !== undefined ? { maxRate: custom.maxRate } : {}),
            ...(custom.baseURL ? { baseURL: custom.baseURL } : {}),
            ...(custom.headers ? { headers: NeutrxHeaders.from(custom.headers) } : {}),
            ...(custom.auth ? { auth: custom.auth } : {}),
            ...(custom.idempotencyKey !== undefined ? { idempotencyKey: custom.idempotencyKey } : {}),
            ...(custom.idempotencyKeyHeader ? { idempotencyKeyHeader: custom.idempotencyKeyHeader } : {}),
            ...(custom.paramsSerializer ? { paramsSerializer: custom.paramsSerializer } : {}),
            ...(custom.formSerializer ? { formSerializer: custom.formSerializer } : {}),
            ...(custom.transformRequest ? { transformRequest: normalizeArray(custom.transformRequest) } : {}),
            ...(custom.transformResponse ? { transformResponse: normalizeArray(custom.transformResponse) } : {}),
            ...(custom.schema !== undefined ? { schema: custom.schema } : {}),
            ...(custom.parseJson ? { parseJson: custom.parseJson } : {}),
            ...(custom.stringifyJson ? { stringifyJson: custom.stringifyJson } : {}),
            adapter: custom.adapter ?? 'fetch',
            ...(custom.fetch ? { fetch: custom.fetch } : {}),
            ...(custom.serviceDiscovery ? { serviceDiscovery: custom.serviceDiscovery } : {}),
            ...(custom.withCredentials !== undefined ? { withCredentials: custom.withCredentials } : {}),
            ...(custom.credentials ? { credentials: custom.credentials } : {}),
            ...(custom.xsrfCookieName !== undefined ? { xsrfCookieName: custom.xsrfCookieName } : {}),
            ...(custom.xsrfHeaderName !== undefined ? { xsrfHeaderName: custom.xsrfHeaderName } : {}),
            ...(custom.withXSRFToken !== undefined ? { withXSRFToken: custom.withXSRFToken } : {}),
            ...(custom.instrumentation ? { instrumentation: custom.instrumentation } : {}),
            proxy: false,
            ...(custom.beforeRedirect ? { beforeRedirect: custom.beforeRedirect } : {}),
            transitional: {
                clarifyTimeoutError: custom.transitional?.clarifyTimeoutError ?? false,
            },
            security: {
                profile: securityProfile,
                allowedProtocols: custom.security?.allowedProtocols ?? ['http', 'https'],
                ...(custom.security?.allowedHosts ? { allowedHosts: custom.security.allowedHosts } : {}),
                ...(custom.security?.deniedHosts ? { deniedHosts: custom.security.deniedHosts } : {}),
                enforceHTTPS: custom.security?.enforceHTTPS ?? false,
                validateCertificate: custom.security?.validateCertificate ?? true,
                enableSSRFProtection: false,
                blockPrivateIPs: false,
                blockLinkLocalIPs: false,
                blockLoopbackIPs: false,
                blockMetadataIPs: true,
                blockDangerousPorts: true,
                reResolveOnRedirect: true,
                blockRedirectToPrivateIP: true,
                allowLocalhost: true,
                sanitizeInputs: custom.security?.sanitizeInputs ?? true,
                sanitizeOutputs: custom.security?.sanitizeOutputs ?? true,
                ...(custom.security?.rateLimit ? { rateLimit: custom.security.rateLimit } : {}),
            },
            ...(custom.egressPolicy ? { egressPolicy: custom.egressPolicy } : {}),
            resilience: {
                enableCircuitBreaker: custom.resilience?.enableCircuitBreaker ?? true,
                failureThreshold: custom.resilience?.failureThreshold ?? 5,
                successThreshold: custom.resilience?.successThreshold ?? 2,
                circuitTimeout: custom.resilience?.circuitTimeout ?? 60_000,
                ...(custom.resilience?.circuitBreakerStorage ? { circuitBreakerStorage: custom.resilience.circuitBreakerStorage } : {}),
                enableRetry: custom.resilience?.enableRetry ?? true,
                maxRetries: custom.resilience?.maxRetries ?? 3,
                retryStrategy: custom.resilience?.retryStrategy ?? 'exponential',
                retryDelay: custom.resilience?.retryDelay ?? 1000,
                maxRetryDelay: custom.resilience?.maxRetryDelay ?? 30_000,
                retryJitter: custom.resilience?.retryJitter ?? true,
                retryMethods: custom.resilience?.retryMethods ?? ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
                ...(custom.resilience?.retryBudget ? { retryBudget: custom.resilience.retryBudget } : {}),
                retryableStatuses: custom.resilience?.retryableStatuses ?? [408, 429, 500, 502, 503, 504],
                retryableCodes: custom.resilience?.retryableCodes ?? ['NETWORK_ERROR', 'REQUEST_ABORTED'],
                enableBulkhead: custom.resilience?.enableBulkhead ?? true,
                maxConcurrent: custom.resilience?.maxConcurrent ?? 10,
                maxQueue: custom.resilience?.maxQueue ?? 100,
                bulkheadQueueTimeout: custom.resilience?.bulkheadQueueTimeout ?? 30_000,
                ...(custom.resilience?.adaptiveConcurrency ? { adaptiveConcurrency: custom.resilience.adaptiveConcurrency } : {}),
                ...(custom.resilience?.shouldRetry ? { shouldRetry: custom.resilience.shouldRetry } : {}),
                ...(custom.resilience?.onRetry ? { onRetry: custom.resilience.onRetry } : {}),
            },
            performance: {
                enableCaching: custom.performance?.enableCaching ?? true,
                cacheMaxSize: custom.performance?.cacheMaxSize ?? 500,
                cacheTTL,
                cacheMaxEntrySize: custom.performance?.cacheMaxEntrySize ?? 1_048_576,
                respectCacheHeaders: custom.performance?.respectCacheHeaders ?? true,
                deduplicateRequests: custom.performance?.deduplicateRequests ?? true,
                ...(custom.performance?.deduplicateRequestKey ? { deduplicateRequestKey: custom.performance.deduplicateRequestKey } : {}),
                deduplicateMethods: normalizeMethodList(custom.performance?.deduplicateMethods ?? ['GET', 'HEAD']),
                deduplicateHeaders: normalizeHeaderNameList(custom.performance?.deduplicateHeaders ?? ['accept', 'authorization', 'range']),
                cacheStrategy: normalizeCacheStrategy(custom.performance?.cacheStrategy),
                ...(custom.performance?.revalidateAfter !== undefined ? { revalidateAfter: custom.performance.revalidateAfter } : {}),
                cacheStaleMax: custom.performance?.cacheStaleMax ?? Math.max(cacheTTL, 1_500_000),
                ...(custom.performance?.cacheAdapter ? { cacheAdapter: custom.performance.cacheAdapter } : {}),
                ...(custom.performance?.onRevalidate ? { onRevalidate: custom.performance.onRevalidate } : {}),
            },
        };
    }

    #id(): string {
        return `ntrx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    #domain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }
}

type BrowserCacheEntry = {
    readonly response: NeutrxResponse;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly staleUntil: number;
    lastAccessed: number;
    revalidatingAt?: number;
    readonly size: number;
};

type BrowserCacheLookup = {
    readonly response: NeutrxResponse;
    readonly state: 'fresh' | 'stale';
};

class BrowserCache {
    #store = new Map<string, BrowserCacheEntry>();
    #locks = new Set<string>();
    #blocked = new Set<string>();
    #stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    #sweepTimer: ReturnType<typeof setInterval> | null = null;
    #enabled: boolean;
    #maxSize: number;
    #ttl: number;
    #revalidateAfter: number | undefined;
    #staleMaxAge: number;
    #maxEntrySize: number;
    #respectHeaders: boolean;
    #strategy: CacheStrategy;

    constructor(config: NormalizedClientConfig['performance']) {
        this.#enabled = config.enableCaching;
        this.#maxSize = config.cacheMaxSize;
        this.#ttl = config.cacheTTL;
        this.#revalidateAfter = config.revalidateAfter;
        this.#staleMaxAge = config.cacheStaleMax;
        this.#maxEntrySize = config.cacheMaxEntrySize;
        this.#respectHeaders = config.respectCacheHeaders;
        this.#strategy = config.cacheStrategy;
        if (this.#enabled) {
            this.#sweepTimer = setInterval(() => this.#sweep(), 60_000);
            const maybeNodeTimer = this.#sweepTimer as { readonly unref?: () => void };
            maybeNodeTimer.unref?.();
        }
    }

    get(config: InternalRequestConfig): NeutrxResponse | null {
        return this.getWithState(config)?.response ?? null;
    }

    getWithState(config: InternalRequestConfig): BrowserCacheLookup | null {
        if (!this.#enabled) return null;
        const key = this.#key(config);
        const entry = this.#store.get(key);
        const now = Date.now();
        if (!entry || (now > entry.expiresAt && (this.#strategy !== 'swr' || now > entry.staleUntil))) {
            if (entry && now > entry.staleUntil) this.#store.delete(key);
            this.#stats.misses += 1;
            return null;
        }

        entry.lastAccessed = now;
        this.#stats.hits += 1;
        const state = now > entry.expiresAt ? 'stale' : 'fresh';
        return {
            state,
            response: {
                ...entry.response,
                cached: true,
                stale: state === 'stale',
                cacheAge: now - entry.createdAt,
                headers: {
                    ...entry.response.headers,
                    'x-cache': state === 'stale' ? 'STALE' : 'HIT',
                    'x-cache-age': String(Math.floor((now - entry.createdAt) / 1000)),
                },
            },
        };
    }

    getNetworkFallback(config: InternalRequestConfig): NeutrxResponse | null {
        if (!this.#enabled || this.#strategy !== 'network-first') return null;
        const key = this.#key(config);
        const entry = this.#store.get(key);
        const now = Date.now();
        if (!entry || now > entry.staleUntil) return null;

        entry.lastAccessed = now;
        this.#stats.hits += 1;
        const stale = now > entry.expiresAt;
        return {
            ...entry.response,
            cached: true,
            stale,
            cacheAge: now - entry.createdAt,
            headers: {
                ...entry.response.headers,
                'x-cache': stale ? 'STALE' : 'HIT',
                'x-cache-age': String(Math.floor((now - entry.createdAt) / 1000)),
            },
        };
    }

    set(config: InternalRequestConfig, response: NeutrxResponse): void {
        if (!this.#enabled || response.status < 200 || response.status >= 300) return;
        const cacheControl = headerToString(response.headers['cache-control']);
        if (cacheControl.includes('no-store') || cacheControl.includes('no-cache') || cacheControl.includes('private')) return;
        const size = byteLength(JSON.stringify({ status: response.status, headers: response.headers, data: response.data }));
        if (size > this.#maxEntrySize) return;
        if (this.#store.size >= this.#maxSize) this.#evict();
        const ttl = this.#responseTTL(response) ?? this.#ttl;
        const freshTTL = this.#freshTTL(ttl);
        const now = Date.now();
        this.#store.set(this.#key(config), {
            response: { ...response },
            createdAt: now,
            expiresAt: now + freshTTL,
            staleUntil: now + this.#staleTTL(ttl, freshTTL),
            lastAccessed: now,
            size,
        });
        this.#stats.sets += 1;
    }

    clear(pattern?: string | RegExp): void {
        this.invalidate(pattern);
    }

    invalidate(pattern?: string | RegExp): number {
        if (!pattern) {
            const count = this.#store.size;
            this.#store.clear();
            this.#locks.clear();
            return count;
        }

        const expression = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        let count = 0;
        for (const key of this.#store.keys()) {
            const entry = this.#store.get(key);
            const url = entry?.response.config.url ?? '';
            if (expression.test(key) || expression.test(url)) {
                this.#store.delete(key);
                this.#locks.delete(key);
                count += 1;
            }
        }
        return count;
    }

    deleteByUrl(url: string): boolean {
        for (const key of this.#store.keys()) {
            const entry = this.#store.get(key);
            if (entry?.response.config.url === url) {
                this.#store.delete(key);
                this.#locks.delete(key);
                return true;
            }
        }
        return false;
    }

    markRevalidating(config: InternalRequestConfig): boolean {
        const key = this.#key(config);
        const entry = this.#store.get(key);
        if (!entry || entry.revalidatingAt !== undefined || this.#locks.has(key)) return false;
        this.#locks.add(key);
        this.#store.set(key, { ...entry, revalidatingAt: Date.now() });
        return true;
    }

    finishRevalidating(config: InternalRequestConfig): void {
        const key = this.#key(config);
        const entry = this.#store.get(key);
        if (entry) {
            const next = { ...entry };
            delete next.revalidatingAt;
            this.#store.set(key, next);
        }
        this.#locks.delete(key);
    }

    strategy(): CacheStrategy {
        return this.#strategy;
    }

    usesNetworkFirst(): boolean {
        return this.#strategy === 'network-first';
    }

    block(domain: string): void {
        this.#blocked.add(domain.toLowerCase().trim());
    }

    isBlocked(domain: string): boolean {
        return this.#blocked.has(domain);
    }

    destroy(): void {
        if (this.#sweepTimer) clearInterval(this.#sweepTimer);
    }

    getStats(): CacheStats {
        const total = this.#stats.hits + this.#stats.misses;
        return {
            ...this.#stats,
            size: this.#store.size,
            maxSize: this.#maxSize,
            hitRate: total > 0 ? `${((this.#stats.hits / total) * 100).toFixed(1)}%` : '0%',
        };
    }

    #key(config: InternalRequestConfig): string {
        return [
            config.url,
            headerToString(config.headers.Accept ?? config.headers.accept),
            headerToString(config.headers.Authorization ?? config.headers.authorization),
        ].join('|');
    }

    #responseTTL(response: NeutrxResponse): number | null {
        if (!this.#respectHeaders) return null;
        const cacheControl = headerToString(response.headers['cache-control']);
        const maxAge = cacheControl.match(/max-age=(\d+)/);
        if (maxAge?.[1]) return Number.parseInt(maxAge[1], 10) * 1000;
        const expires = response.headers.expires;
        if (!expires) return null;
        const timestamp = new Date(headerToString(expires)).getTime() - Date.now();
        return timestamp > 0 ? timestamp : null;
    }

    #evict(): void {
        let oldestKey: string | null = null;
        let oldestTime = Number.POSITIVE_INFINITY;
        for (const [key, value] of this.#store) {
            if (value.lastAccessed < oldestTime) {
                oldestTime = value.lastAccessed;
                oldestKey = key;
            }
        }
        if (oldestKey) {
            this.#store.delete(oldestKey);
            this.#stats.evictions += 1;
        }
    }

    #sweep(): void {
        const now = Date.now();
        for (const [key, value] of this.#store) {
            const expiresAt = this.#strategy === 'swr' || this.#strategy === 'network-first' ? value.staleUntil : value.expiresAt;
            if (now > expiresAt) {
                this.#store.delete(key);
                this.#locks.delete(key);
            }
        }
    }

    #freshTTL(ttl: number): number {
        if (this.#strategy === 'max-age' || this.#revalidateAfter === undefined) return ttl;
        return Math.min(ttl, Math.max(0, this.#revalidateAfter));
    }

    #staleTTL(ttl: number, freshTTL: number): number {
        if (this.#strategy === 'swr') return Math.max(ttl, freshTTL, this.#staleMaxAge);
        if (this.#strategy === 'network-first') return Math.max(ttl, freshTTL);
        return freshTTL;
    }
}

class BrowserMetrics {
    #requests: BrowserRequestMetrics = { total: 0, active: 0, success: 0, errors: 0, cached: 0, retried: 0, deduplicated: 0 };
    #durations: number[] = [];
    #byStatus: Record<string, number> = {};
    #errors: BrowserErrorMetrics = { byType: {}, byCode: {}, byCategory: {} };

    recordStart(): void {
        this.#requests.active += 1;
    }

    recordEnd(): void {
        this.#requests.active = Math.max(0, this.#requests.active - 1);
    }

    recordSuccess(_url: string, duration: number, status: number): void {
        this.#requests.success += 1;
        this.#requests.total += 1;
        this.#durations.push(duration);
        this.#inc(this.#byStatus, String(status));
    }

    recordError(_url: string, error: Error & { readonly code?: string; readonly category?: string }): void {
        this.#requests.errors += 1;
        this.#requests.total += 1;
        this.#inc(this.#errors.byType, error.name);
        this.#inc(this.#errors.byCode, error.code ?? 'UNKNOWN');
        this.#inc(this.#errors.byCategory, error.category ?? 'unknown');
    }

    recordCacheHit(): void {
        this.#requests.cached += 1;
        this.#requests.total += 1;
    }

    recordRetry(): void {
        this.#requests.retried += 1;
    }

    recordDeduplicationHit(): void {
        this.#requests.deduplicated += 1;
    }

    getAll(): BrowserMetricsSnapshot {
        const totalDuration = this.#durations.reduce((sum, duration) => sum + duration, 0);
        const performance = {
            min: this.#durations.length ? Math.min(...this.#durations) : 0,
            max: this.#durations.length ? Math.max(...this.#durations) : 0,
            avg: this.#durations.length ? Math.round(totalDuration / this.#durations.length) : 0,
            total: totalDuration,
            p50: quantile(this.#durations, 0.50),
            p90: quantile(this.#durations, 0.90),
            p95: quantile(this.#durations, 0.95),
            p99: quantile(this.#durations, 0.99),
        };
        const { total, success, errors, cached, deduplicated } = this.#requests;
        return {
            requests: this.#requests,
            performance,
            byStatus: this.#byStatus,
            byEndpoint: {},
            errors: this.#errors,
            summary: {
                total,
                successRate: total > 0 ? `${((success / total) * 100).toFixed(2)}%` : '0%',
                errorRate: total > 0 ? `${((errors / total) * 100).toFixed(2)}%` : '0%',
                cacheRate: total > 0 ? `${((cached / total) * 100).toFixed(2)}%` : '0%',
                deduplicationRate: total > 0 ? `${((deduplicated / total) * 100).toFixed(2)}%` : '0%',
                avgDuration: `${performance.avg}ms`,
                p99: `${performance.p99}ms`,
            },
        };
    }

    toPrometheus(): string {
        return [
            '# TYPE neutrx_requests_total counter',
            `neutrx_requests_total{status="success"} ${this.#requests.success}`,
            `neutrx_requests_total{status="error"} ${this.#requests.errors}`,
            `neutrx_requests_total{status="cached"} ${this.#requests.cached}`,
            `neutrx_requests_total{status="retried"} ${this.#requests.retried}`,
            `neutrx_requests_total{status="deduplicated"} ${this.#requests.deduplicated}`,
            '',
            '# TYPE neutrx_active_requests gauge',
            `neutrx_active_requests ${this.#requests.active}`,
            '',
            '# TYPE neutrx_deduplication_hits_total counter',
            `neutrx_deduplication_hits_total ${this.#requests.deduplicated}`,
            '',
            '# TYPE neutrx_cache_hits_total counter',
            `neutrx_cache_hits_total ${this.#requests.cached}`,
            '',
            '# TYPE neutrx_retries_total counter',
            `neutrx_retries_total ${this.#requests.retried}`,
            '',
            '# TYPE neutrx_status_total counter',
            ...Object.entries(this.#byStatus).map(([status, count]) => `neutrx_status_total{status="${prometheusLabel(status)}"} ${count}`),
            '',
            '# TYPE neutrx_errors_by_code_total counter',
            ...Object.entries(this.#errors.byCode).map(([code, count]) => `neutrx_errors_by_code_total{code="${prometheusLabel(code)}"} ${count}`),
            '',
            '# TYPE neutrx_errors_total counter',
            ...Object.entries(this.#errors.byCategory).map(([category, count]) => `neutrx_errors_total{category="${prometheusLabel(category)}"} ${count}`),
        ].join('\n');
    }

    reset(): void {
        this.#requests = { total: 0, active: 0, success: 0, errors: 0, cached: 0, retried: 0, deduplicated: 0 };
        this.#durations = [];
        this.#byStatus = {};
        this.#errors = { byType: {}, byCode: {}, byCategory: {} };
    }

    destroy(): void {
        this.reset();
    }

    #inc(target: Record<string, number>, key: string): void {
        target[key] = (target[key] ?? 0) + 1;
    }
}

function normalizeMethod(method: string): HttpMethod {
    const normalized = method.toUpperCase();
    if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(normalized)) {
        return normalized as HttpMethod;
    }
    throw new NeutrxSecurityError(`Invalid HTTP method: ${method}`, { code: 'INVALID_METHOD' });
}

function normalizeMethodList(methods: readonly string[]): readonly HttpMethod[] {
    return [...new Set(methods.map(method => normalizeMethod(method)))];
}

function normalizeHeaderNameList(names: readonly string[]): readonly string[] {
    return [...new Set(names.map(name => name.toLowerCase()))].sort();
}

function normalizeArray<TValue>(value: TValue | readonly TValue[]): readonly TValue[] {
    return (Array.isArray(value) ? value : [value]) as readonly TValue[];
}

function mergeTransformRequest(
    base?: readonly TransformRequest[],
    override?: TransformRequest | readonly TransformRequest[]
): readonly TransformRequest[] | undefined {
    const merged = [
        ...(base ?? []),
        ...(override ? normalizeArray(override) : []),
    ];
    return merged.length > 0 ? merged : undefined;
}

function mergeTransformResponse(
    base?: readonly TransformResponse[],
    override?: TransformResponse | readonly TransformResponse[]
): readonly TransformResponse[] | undefined {
    const merged = [
        ...(base ?? []),
        ...(override ? normalizeArray(override) : []),
    ];
    return merged.length > 0 ? merged : undefined;
}

function applyRequestTransforms(
    data: RequestBody | undefined,
    headers: InternalHeaders,
    transforms?: readonly TransformRequest[]
): RequestBody | undefined {
    return (transforms ?? []).reduce<RequestBody | undefined>((current, transform) => transform(current, headers), data);
}

function applyResponseTransforms(
    data: ParsedResponseData,
    headers: Headers,
    status: number,
    transforms?: readonly TransformResponse[]
): ParsedResponseData {
    return (transforms ?? []).reduce<ParsedResponseData>((current, transform) => transform(current, headers, status), data);
}

function serializeParams(params: QueryParams, serializer?: RequestConfig['paramsSerializer']): string {
    if (typeof serializer === 'function') return serializer(params);
    if (serializer?.serialize) return serializer.serialize(params);

    const encoded = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) appendSearchParam(encoded, key, value, serializer?.encode, serializer?.indexes);
    return encoded.toString();
}

function appendQueryString(url: string, serializedParams: string): string {
    const query = serializedParams.startsWith('?') ? serializedParams.slice(1) : serializedParams;
    if (!query) return url;

    const hashIndex = url.indexOf('#');
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const separator = base.includes('?')
        ? base.endsWith('?') || base.endsWith('&') ? '' : '&'
        : '?';

    return `${base}${separator}${query}${hash}`;
}

function appendSearchParam(
    params: URLSearchParams,
    key: string,
    value: QueryValue,
    encode?: (value: string) => string,
    indexes?: boolean | null
): void {
    if (value == null) return;
    const encodedKey = encode ? encode(key) : key;
    if (Array.isArray(value)) {
        const items = value as readonly QueryValue[];
        items.forEach((item, index) => appendSearchParam(params, arrayParamKey(key, index, indexes), item, encode, indexes));
        return;
    }
    if (typeof value === 'object') {
        const record = value as QueryParams;
        for (const childKey of Object.keys(record)) {
            const child = record[childKey];
            appendSearchParam(params, `${key}[${childKey}]`, child, encode, indexes);
        }
        return;
    }
    params.append(encodedKey, encode ? encode(String(value)) : String(value));
}

function arrayParamKey(key: string, index: number, indexes?: boolean | null): string {
    if (indexes === true) return `${key}[${index}]`;
    if (indexes === false) return `${key}[]`;
    return key;
}

function toFetchBody(config: RuntimeRequestConfig): FetchBody | undefined {
    const data = config.data;
    if (data === undefined) return undefined;
    if (typeof data === 'string') {
        reportKnownUploadProgress(config, byteLength(data));
        return data;
    }
    if (data instanceof ArrayBuffer) {
        reportKnownUploadProgress(config, data.byteLength);
        return data;
    }
    if (ArrayBuffer.isView(data)) {
        reportKnownUploadProgress(config, data.byteLength);
        return data;
    }
    if (data instanceof URLSearchParams) {
        const rendered = data.toString();
        reportKnownUploadProgress(config, byteLength(rendered));
        return data;
    }
    if (isBlobLike(data)) {
        reportKnownUploadProgress(config, data.size);
        return data;
    }
    if (isFormDataLike(data)) return data;
    if (isStreamLike(data)) return trackReadableStreamUploadProgress(data, config, requestContentLength(config.headers)) as FetchBody;

    if (isUrlEncodedRequest(config.headers) && isPlainBodyRecord(data)) {
        const rendered = toUrlEncodedBody(data).toString();
        reportKnownUploadProgress(config, byteLength(rendered));
        return rendered as FetchBody;
    }

    const rendered = (config.stringifyJson ?? JSON.stringify)(data);
    reportKnownUploadProgress(config, byteLength(rendered));
    return rendered as FetchBody;
}

function toFetchHeaders(headers: Headers | NeutrxHeaders): globalThis.Headers {
    const next = new globalThis.Headers();
    for (const [key, value] of Object.entries(NeutrxHeaders.from(headers).toJSON())) next.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    return next;
}

function injectXsrfHeader(config: RuntimeRequestConfig): void {
    if (!isStandardBrowserEnvironment() || !config.xsrfCookieName || !config.xsrfHeaderName) return;
    const shouldInject = typeof config.withXSRFToken === 'function'
        ? config.withXSRFToken(config)
        : config.withXSRFToken === true || (config.withXSRFToken !== false && isSameOrigin(config.url));
    if (!shouldInject) return;
    const token = readCookie(config.xsrfCookieName);
    if (token) config.headers.setIfNotBlocked(config.xsrfHeaderName, token);
}

function credentialsFor(withCredentials: boolean | undefined, credentials: RuntimeRequestConfig['credentials']): FetchCredentials {
    if (credentials) return credentials;
    if (withCredentials === true) return 'include';
    if (withCredentials === false) return 'omit';
    return 'same-origin';
}

function withUrlEncodedHeaders<TBody extends RequestBody, TSchema extends ResponseSchemaOption | undefined>(
    config: BodyRequestConfig<TBody, TSchema>
): BodyRequestConfig<TBody, TSchema> {
    return {
        ...config,
        headers: NeutrxHeaders.concat({ 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, config.headers),
    };
}

function egressPolicyAudit(policy: NormalizedClientConfig['egressPolicy']): EgressPolicyAudit {
    return {
        mode: policy?.mode ?? 'custom',
        allowedProtocols: policy?.allowedProtocols ?? [],
        requireHttps: policy?.requireHttps ?? false,
        requirePublicDns: policy?.requirePublicDns ?? false,
        blockCloudMetadata: policy?.blockCloudMetadata ?? false,
        ...(policy?.allowedHosts ? { allowedHosts: policy.allowedHosts } : {}),
        ...(policy?.deniedHosts ? { deniedHosts: policy.deniedHosts } : {}),
        ...(policy?.allowedCidrs ? { allowedCidrs: policy.allowedCidrs } : {}),
        ...(policy?.deniedCidrs ? { deniedCidrs: policy.deniedCidrs } : {}),
        ...(policy?.allowedPorts ? { allowedPorts: policy.allowedPorts } : {}),
        ...(policy?.allowRedirectsTo ? { allowRedirectsTo: policy.allowRedirectsTo } : {}),
        ...(policy?.allowedSni ? { allowedSni: policy.allowedSni } : {}),
    };
}

function toFormBody(data: RequestBody): RequestBody {
    if (isFormDataLike(data) || data === null || typeof data !== 'object') return data;
    if (
        data instanceof URLSearchParams
        || data instanceof ArrayBuffer
        || ArrayBuffer.isView(data)
        || isBlobLike(data)
        || isStreamLike(data)
    ) return data;

    if (typeof FormData === 'undefined') return data;
    const form = new FormData();
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) appendBrowserFormValue(form, key, value);
    return form;
}

function toUrlEncodedBody(data: Record<string, unknown>): URLSearchParams {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) appendUrlEncodedValue(params, key, value);
    return params;
}

function appendUrlEncodedValue(params: URLSearchParams, key: string, value: unknown): void {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
        value.forEach(item => appendUrlEncodedValue(params, key, item));
        return;
    }
    if (typeof value === 'object' && !isBlobLike(value)) {
        for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
            appendUrlEncodedValue(params, `${key}[${childKey}]`, child);
        }
        return;
    }
    params.append(key, scalarToString(value));
}

function scalarToString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (typeof value === 'symbol') return value.description ?? '';
    if (typeof value === 'function') return value.name || '[function]';
    return JSON.stringify(value) ?? '';
}

function isUrlEncodedRequest(headers: Headers | NeutrxHeaders): boolean {
    return headerToString(getHeader(headers, 'Content-Type')).includes('application/x-www-form-urlencoded');
}

function isPlainBodyRecord(value: RequestBody): value is Record<string, unknown> {
    return value !== null
        && typeof value === 'object'
        && !(value instanceof URLSearchParams)
        && !(value instanceof ArrayBuffer)
        && !ArrayBuffer.isView(value)
        && !isBlobLike(value)
        && !isFormDataLike(value)
        && !isStreamLike(value)
        && !Array.isArray(value);
}

function appendBrowserFormValue(form: FormData, key: string, value: unknown): void {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
        value.forEach(item => appendBrowserFormValue(form, key, item));
        return;
    }
    if (isBlobLike(value)) {
        form.append(key, value);
        return;
    }
    if (typeof value === 'object') {
        form.append(key, JSON.stringify(value));
        return;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        form.append(key, `${value}`);
        return;
    }
    if (typeof value === 'symbol') {
        form.append(key, value.description ?? '');
        return;
    }
    if (typeof value === 'function') {
        form.append(key, value.name);
        return;
    }
    form.append(key, value);
}

function isSameOrigin(url: string): boolean {
    try {
        const location = (globalThis as BrowserGlobal).location;
        if (!location) return false;
        return new URL(url, location.href).origin === location.origin;
    } catch {
        return false;
    }
}

function readCookie(name: string): string | null {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`).exec((globalThis as BrowserGlobal).document?.cookie ?? '');
    return match ? decodeURIComponent(match[1] ?? '') : null;
}

function isStandardBrowserEnvironment(): boolean {
    const browserGlobal = globalThis as BrowserGlobal;
    return typeof browserGlobal.window !== 'undefined'
        && typeof browserGlobal.document !== 'undefined'
        && typeof browserGlobal.document.cookie === 'string';
}

function fromFetchHeaders(headers: globalThis.Headers): Headers {
    const next: Headers = {};
    headers.forEach((value, key) => {
        next[key] = value;
    });
    return next;
}

async function readResponseData(response: Response, config: RuntimeRequestConfig, total?: number): Promise<RawHttpResponse['data']> {
    if (config.responseType === 'blob' && typeof response.blob === 'function') return response.blob();
    if (config.responseType === 'formData' && typeof response.formData === 'function') return response.formData();
    if (config.responseType === 'stream') return trackFetchDownloadStream(response.body, config, total);

    if (!response.body || !config.onDownloadProgress) {
        reportDownloadProgress(config, 0, total);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > config.maxContentLength) throw new NeutrxResponseSizeError(buffer.byteLength, config.maxContentLength);
        reportDownloadProgress(config, buffer.byteLength, total ?? buffer.byteLength);
        return config.responseType === 'buffer' || config.responseType === 'arrayBuffer' ? buffer : decodeText(buffer, config.responseEncoding);
    }

    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    reportDownloadProgress(config, loaded, total);

    let done = false;
    while (!done) {
        const read = await reader.read();
        done = read.done;
        const value = read.value;
        if (done) break;
        if (!value) continue;
        loaded += value.byteLength;
        if (loaded > config.maxContentLength) throw new NeutrxResponseSizeError(loaded, config.maxContentLength);
        chunks.push(value);
        reportDownloadProgress(config, loaded, total);
    }

    const buffer = toArrayBuffer(concatChunks(chunks, loaded));
    return config.responseType === 'buffer' || config.responseType === 'arrayBuffer' ? buffer : decodeText(buffer, config.responseEncoding);
}

function parseResponseData(
    data: RawHttpResponse['data'],
    type: ResponseType,
    headers: Headers,
    encoding: BufferEncoding,
    parseJson: ParseJson = defaultParseJson
): ParsedResponseData {
    if (type === 'stream') return data;
    if (type === 'blob' && isBlobLike(data)) return data;
    if (type === 'formData' && isFormDataLike(data)) return data;
    if (type === 'buffer' || type === 'arrayBuffer') {
        if (data instanceof ArrayBuffer) return data;
        if (ArrayBuffer.isView(data)) return toArrayBuffer(data);
        if (typeof data === 'string') return stringToArrayBuffer(data);
        return new ArrayBuffer(0);
    }

    const text = typeof data === 'string'
        ? data
        : data instanceof ArrayBuffer
            ? decodeText(data, encoding)
            : '';
    const contentType = headerToString(headers['content-type']);

    if (type === 'text') return text;
    if (type === 'json' || contentType.includes('application/json')) {
        try {
            return parseJson(text);
        } catch {
            return text;
        }
    }
    return text;
}

function defaultParseJson(text: string): ParsedResponseData {
    return JSON.parse(text, safeReviver) as JsonValue;
}

function safeReviver(key: string, value: JsonValue): JsonValue | undefined {
    if (DANGEROUS_KEYS.has(key)) return undefined;
    return value;
}

function detectContentType(data: RequestBody): string | undefined {
    if (typeof data === 'string') return 'text/plain';
    if (isFormDataLike(data)) return undefined;
    if (isBlobLike(data)) return data.type || 'application/octet-stream';
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data) || isStreamLike(data)) return 'application/octet-stream';
    if (data instanceof URLSearchParams) return 'application/x-www-form-urlencoded';
    return 'application/json';
}

function bodyless(method: string): boolean {
    return method === 'GET' || method === 'HEAD';
}

function isJsonContainer(value: ParsedResponseData): value is JsonValue & object {
    return value !== null
        && typeof value === 'object'
        && !(value instanceof ArrayBuffer)
        && !ArrayBuffer.isView(value)
        && !(value instanceof URLSearchParams)
        && !isStreamLike(value);
}

function sanitizeBody<TBody extends RequestBody>(value: TBody): TBody {
    if (typeof value === 'string') return sanitizeString(value) as TBody;
    if (value === null || typeof value !== 'object') return value;
    if (
        value instanceof URLSearchParams
        || value instanceof ArrayBuffer
        || ArrayBuffer.isView(value)
        || isBlobLike(value)
        || isFormDataLike(value)
        || isStreamLike(value)
    ) return value;
    return sanitizeJson(value as JsonValue) as TBody;
}

function sanitizeJson(value: JsonValue, depth = 0): JsonValue {
    if (depth > MAX_OBJECT_DEPTH) throw new NeutrxSecurityError('Object depth limit exceeded', { code: 'DEPTH_EXCEEDED' });
    if (typeof value === 'string') return sanitizeString(value);
    if (typeof value !== 'object' || value === null) return value;
    if (Array.isArray(value)) {
        const items = value as readonly JsonValue[];
        return items.map(item => sanitizeJson(item, depth + 1));
    }

    const result: Record<string, JsonValue> = {};
    const objectValue = value as Record<string, JsonValue>;
    for (const [key, child] of Object.entries(objectValue)) {
        if (DANGEROUS_KEYS.has(key)) throw new NeutrxSecurityError(`Prototype pollution attempt: ${key}`, { code: 'PROTOTYPE_POLLUTION' });
        result[key] = sanitizeJson(child, depth + 1);
    }
    return result;
}

function sanitizeString(value: string): string {
    const sanitized = value.replace(/\0/g, '');
    if (DANGEROUS_KEYS.has(sanitized.trim())) {
        throw new NeutrxSecurityError(`Prototype pollution attempt: ${sanitized}`, { code: 'PROTOTYPE_POLLUTION' });
    }
    return sanitized;
}

function contentLength(headers: globalThis.Headers): number | undefined {
    const value = headers.get('content-length');
    if (!value) return undefined;
    const length = Number.parseInt(value, 10);
    return Number.isFinite(length) && length >= 0 ? length : undefined;
}

type ProgressDirection = 'upload' | 'download';
type ProgressState = { readonly loaded: number; readonly timestamp: number };
const uploadProgressState = new WeakMap<InternalRequestConfig, ProgressState>();
const downloadProgressState = new WeakMap<InternalRequestConfig, ProgressState>();

function reportUploadProgress(config: InternalRequestConfig, loaded: number, total?: number): void {
    reportProgress(config, 'upload', config.onUploadProgress, loaded, total);
}

function reportDownloadProgress(config: InternalRequestConfig, loaded: number, total?: number): void {
    reportProgress(config, 'download', config.onDownloadProgress, loaded, total);
}

function reportKnownUploadProgress(config: InternalRequestConfig, total: number): void {
    reportUploadProgress(config, 0, total);
    reportUploadProgress(config, total, total);
}

function requestContentLength(headers: Headers | NeutrxHeaders): number | undefined {
    const length = Number.parseInt(headerToString(getHeader(headers, 'Content-Length')), 10);
    return Number.isFinite(length) && length >= 0 ? length : undefined;
}

function trackReadableStreamUploadProgress(
    stream: ReadableStream<Uint8Array>,
    config: InternalRequestConfig,
    total?: number
): ReadableStream<Uint8Array> {
    if (!config.onUploadProgress || typeof TransformStream === 'undefined') return stream;

    let loaded = 0;
    reportUploadProgress(config, loaded, total);
    return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller): void {
            loaded += chunk.byteLength;
            reportUploadProgress(config, loaded, total);
            controller.enqueue(chunk);
        },
    }));
}

function trackFetchDownloadStream(
    stream: ReadableStream<Uint8Array> | null,
    config: InternalRequestConfig,
    total?: number
): ReadableStream<Uint8Array> | null {
    if (!stream || !config.onDownloadProgress || typeof TransformStream === 'undefined') return stream;

    let loaded = 0;
    reportDownloadProgress(config, loaded, total);
    return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller): void {
            loaded += chunk.byteLength;
            reportDownloadProgress(config, loaded, total);
            controller.enqueue(chunk);
        },
    }));
}

function reportProgress(
    config: InternalRequestConfig,
    direction: ProgressDirection,
    callback: ((event: ProgressEvent) => void) | undefined,
    loaded: number,
    total?: number
): void {
    if (!callback) return;
    const stateMap = direction === 'upload' ? uploadProgressState : downloadProgressState;
    const previous = stateMap.get(config);
    const now = Date.now();
    const bytes = Math.max(0, loaded - (previous?.loaded ?? 0));
    const elapsedMs = Math.max(1, now - (previous?.timestamp ?? now));
    const rate = previous ? Math.round((bytes * 1000) / elapsedMs) : 0;
    callback({
        loaded,
        bytes,
        rate,
        ...(direction === 'upload' ? { upload: true as const } : { download: true as const }),
        ...(total !== undefined ? { total } : {}),
        ...(total !== undefined && total > 0 ? { percent: Math.min(100, Number(((loaded / total) * 100).toFixed(2))) } : {}),
        ...(total !== undefined && total > 0 ? { progress: Math.min(1, Number((loaded / total).toFixed(4))) } : {}),
        ...(total !== undefined && rate > 0 ? { estimated: Number(((Math.max(0, total - loaded)) / rate).toFixed(3)) } : {}),
    });
    stateMap.set(config, { loaded, timestamp: now });
}

function byteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function decodeText(buffer: ArrayBuffer, encoding: BufferEncoding): string {
    try {
        return new TextDecoder(encoding).decode(buffer);
    } catch {
        return new TextDecoder().decode(buffer);
    }
}

function concatChunks(chunks: readonly Uint8Array[], size: number): Uint8Array {
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function stringToArrayBuffer(value: string): ArrayBuffer {
    return toArrayBuffer(new TextEncoder().encode(value));
}

function quantile(values: readonly number[], pct: number): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * pct))] ?? 0;
}

function prometheusLabel(value: string): string {
    return value.replace(/\\/gu, '\\\\').replace(/\n/gu, '\\n').replace(/"/gu, '\\"');
}

function isBlobLike(value: unknown): value is Blob {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly arrayBuffer?: unknown }).arrayBuffer === 'function'
        && typeof (value as { readonly size?: unknown }).size === 'number'
        && typeof (value as { readonly type?: unknown }).type === 'string';
}

function isFormDataLike(value: unknown): value is FormData {
    return typeof FormData !== 'undefined' && value instanceof FormData;
}

function isStreamLike(value: unknown): value is ReadableStream<Uint8Array> {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly getReader?: unknown }).getReader === 'function';
}

function dig(value: ParsedResponseData, path: string): ParsedResponseData {
    return path.split('.').reduce<ParsedResponseData>((current, key) => {
        if (current !== null && typeof current === 'object' && isJsonContainer(current) && key in current) {
            const indexed = current as Record<string, ParsedResponseData>;
            return indexed[key] ?? null;
        }
        return null;
    }, value);
}

function base64(value: string): string {
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(value)));
    if (typeof Buffer !== 'undefined') return Buffer.from(value).toString('base64');
    throw new NeutrxSecurityError('Base64 encoding unavailable in this runtime', { code: 'BASE64_UNAVAILABLE' });
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
}

function toInternalRequestConfig<TBody extends RequestBody>(config: InternalRequestConfig<TBody>): InternalRequestConfig<TBody> {
    return {
        ...config,
        headers: normalizeRequestHeaders(config.headers),
    };
}

function withoutSignal(config: InternalRequestConfig): InternalRequestConfig {
    const copy = { ...config } as { cancelToken?: unknown; signal?: AbortSignal };
    delete copy.signal;
    delete copy.cancelToken;
    return copy as InternalRequestConfig;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function mergeConfig(base: NormalizedClientConfig, override: ClientConfig): ClientConfig {
    const overrideProfile = override.security?.profile === undefined
        ? undefined
        : normalizeSecurityProfile(override.security.profile);
    const security = overrideProfile && overrideProfile !== base.security.profile
        ? { ...override.security, profile: overrideProfile }
        : { ...base.security, ...(override.security ?? {}), ...(overrideProfile ? { profile: overrideProfile } : {}) };
    const headers = base.headers || override.headers
        ? NeutrxHeaders.concat(base.headers, override.headers)
        : undefined;

        return {
            ...base,
            ...override,
            ...(headers ? { headers } : {}),
            security,
            transitional: { ...base.transitional, ...(override.transitional ?? {}) },
            resilience: { ...base.resilience, ...(override.resilience ?? {}) },
            performance: { ...base.performance, ...(override.performance ?? {}) },
        };
}
