import InterceptorChain, { type NeutrxInterceptors } from '../interceptors/InterceptorChain.js';
import { PluginManager, type NeutrxPlugin } from '../plugins/PluginManager.js';
import CircuitBreaker from '../resilience/CircuitBreaker.js';
import { RetryEngine } from '../resilience/RetryEngine.js';
import Bulkhead from '../resilience/Bulkhead.js';
import { normalizeSecurityProfile } from '../security/profiles.js';
import {
    NeutrxError,
    NeutrxErrorFactory,
    NeutrxResponseSizeError,
    NeutrxSecurityError,
} from './NeutrxError.js';
import type {
    AuthConfig,
    BulkheadStats,
    CacheStats,
    CircuitStatus,
    ClientConfig,
    ConcurrentOptions,
    ConcurrentResult,
    FetchCredentials,
    GraphQLResult,
    Headers,
    HttpMethod,
    InternalRequestConfig,
    JsonValue,
    MockController,
    NeutrxResponse,
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
    RetryContext,
    ResponseType,
    SseHandle,
    TransformRequest,
    TransformResponse,
} from '../types.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_URL_LENGTH = 2048;
const MAX_HEADER_SIZE = 8192;
const MAX_HEADER_COUNT = 100;
const MAX_OBJECT_DEPTH = 10;

type BodylessRequestConfig = Omit<RequestConfig, 'url' | 'method' | 'data'>;
type BodyRequestConfig<TBody extends RequestBody> = Omit<RequestConfig<TBody>, 'url' | 'method' | 'data'>;
type RuntimeRequestConfig = InternalRequestConfig & { headers: Headers };
type BrowserListener = (payload: unknown) => void;
type FetchInit = RequestInit & { duplex?: 'half' };
type FetchBody = NonNullable<RequestInit['body']>;
type BrowserRequestMetrics = { total: number; active: number; success: number; errors: number; cached: number; retried: number };
type BrowserErrorMetrics = { byType: Record<string, number>; byCode: Record<string, number> };
type BrowserMetricsSnapshot = {
    readonly requests: BrowserRequestMetrics;
    readonly performance: { readonly min: number; readonly max: number; readonly avg: number; readonly total: number; readonly p50: number; readonly p90: number; readonly p95: number; readonly p99: number };
    readonly byStatus: Record<string, number>;
    readonly byEndpoint: Record<string, never>;
    readonly errors: BrowserErrorMetrics;
    readonly summary: { readonly total: number; readonly successRate: string; readonly errorRate: string; readonly cacheRate: string; readonly avgDuration: string; readonly p99: string };
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
    gql?: <TData extends JsonValue = JsonValue>(
        endpoint: string,
        query: string,
        variables?: Record<string, JsonValue>,
        options?: { readonly operationName?: string; readonly headers?: Headers }
    ) => Promise<GraphQLResult<TData>>;
    mock?: MockController;
    readonly interceptors: NeutrxInterceptors;

    #config: NormalizedClientConfig;
    #interceptors = new InterceptorChain();
    #circuitBreaker: CircuitBreaker;
    #retryEngine: RetryEngine;
    #bulkhead: Bulkhead;
    #cache: BrowserCache;
    #metrics = new BrowserMetrics();
    #plugins: PluginManager;
    #defaultHeaders: Headers;

    constructor(config: ClientConfig = {}) {
        super();
        this.#config = this.#buildConfig(config);
        this.#circuitBreaker = new CircuitBreaker(this.#config.resilience);
        this.#retryEngine = new RetryEngine(this.#config.resilience);
        this.#bulkhead = new Bulkhead(this.#config.resilience);
        this.#cache = new BrowserCache(this.#config.performance);
        this.#plugins = new PluginManager(this as never);
        this.#defaultHeaders = this.#buildDefaultHeaders();
        this.interceptors = this.#interceptors.managers();
    }

    get<TData extends ParsedResponseData = ParsedResponseData>(url: string, config: BodylessRequestConfig = {}): Promise<NeutrxResponse<TData>> {
        return this.request<TData>({ ...config, method: 'GET', url });
    }

    post<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody> = {}
    ): Promise<NeutrxResponse<TData>> {
        return this.request<TData, TBody>({ ...config, method: 'POST', url, data });
    }

    postForm<TData extends ParsedResponseData = ParsedResponseData>(
        url: string,
        data: RequestBody,
        config: BodyRequestConfig<RequestBody> = {}
    ): Promise<NeutrxResponse<TData>> {
        return this.request<TData>({ ...config, method: 'POST', url, data: toFormBody(data) });
    }

    put<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody> = {}
    ): Promise<NeutrxResponse<TData>> {
        return this.request<TData, TBody>({ ...config, method: 'PUT', url, data });
    }

    putForm<TData extends ParsedResponseData = ParsedResponseData>(
        url: string,
        data: RequestBody,
        config: BodyRequestConfig<RequestBody> = {}
    ): Promise<NeutrxResponse<TData>> {
        return this.request<TData>({ ...config, method: 'PUT', url, data: toFormBody(data) });
    }

    patch<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody> = {}
    ): Promise<NeutrxResponse<TData>> {
        return this.request<TData, TBody>({ ...config, method: 'PATCH', url, data });
    }

    patchForm<TData extends ParsedResponseData = ParsedResponseData>(
        url: string,
        data: RequestBody,
        config: BodyRequestConfig<RequestBody> = {}
    ): Promise<NeutrxResponse<TData>> {
        return this.request<TData>({ ...config, method: 'PATCH', url, data: toFormBody(data) });
    }

    delete<TData extends ParsedResponseData = ParsedResponseData>(url: string, config: BodylessRequestConfig = {}): Promise<NeutrxResponse<TData>> {
        return this.request<TData>({ ...config, method: 'DELETE', url });
    }

    head<TData extends ParsedResponseData = ParsedResponseData>(url: string, config: BodylessRequestConfig = {}): Promise<NeutrxResponse<TData>> {
        return this.request<TData>({ ...config, method: 'HEAD', url });
    }

    options<TData extends ParsedResponseData = ParsedResponseData>(url: string, config: BodylessRequestConfig = {}): Promise<NeutrxResponse<TData>> {
        return this.request<TData>({ ...config, method: 'OPTIONS', url });
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
        await Promise.race([Promise.all(workers), rejectAfter(timeout, 'concurrent timeout')]);
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

    upload<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody> = {}
    ): Promise<NeutrxResponse<TData>> {
        return this.request<TData, TBody>({ ...config, method: 'POST', url, data });
    }

    download(url: string, config: BodylessRequestConfig = {}): Promise<NeutrxResponse<ArrayBuffer>> {
        return this.request<ArrayBuffer>({ ...config, method: 'GET', url, responseType: 'buffer' });
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

    async request<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        config: RequestConfig<TBody>
    ): Promise<NeutrxResponse<TData>> {
        const requestId = this.#id();
        const t0 = Date.now();
        let trackedUrl = config.url;
        let circuitChecked = false;
        this.#metrics.recordStart();

        try {
            let rc: InternalRequestConfig = this.#buildRC(config, requestId);
            trackedUrl = rc.url;

            rc = await this.#plugins.runHook('beforeRequest', rc);
            if (rc.mockResponse) return rc.mockResponse as NeutrxResponse<TData>;

            rc = this.#validateRequest(rc);

            if (rc.method === 'GET' && rc.cache !== false) {
                const hit = this.#cache.get(rc);
                if (hit) {
                    this.#metrics.recordCacheHit();
                    this.emit('cache:hit', { requestId, url: rc.url });
                    return hit as NeutrxResponse<TData>;
                }
            }

            rc = await this.#interceptors.runRequest(rc);
            this.#circuitBreaker.canRequest(rc.url);
            circuitChecked = true;

            const domain = this.#domain(rc.url);
            const retryContext: RetryContext = {
                url: rc.url,
                method: rc.method,
                deadlineAt: rc.startTime + rc.timeout,
                ...(rc.signal ? { signal: rc.signal } : {}),
            };
            const { result: response, attempts } = await this.#retryEngine.execute(
                async (attempt): Promise<NeutrxResponse<TData>> => {
                    if (attempt > 0) this.#metrics.recordRetry();
                    const raw = await this.#bulkhead.execute(domain, () => this.#dispatch(rc));
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
            this.#circuitBreaker.recordSuccess(rc.url);
            this.emit('request:success', {
                requestId,
                url: rc.url,
                method: rc.method,
                status: next.status,
                duration,
                attempts: attempts.length,
            });

            return next as NeutrxResponse<TData>;
        } catch (error: unknown) {
            const normalized = normalizeError(error) as Error & { requestId?: string; duration?: number; code?: string };
            normalized.requestId = requestId;
            normalized.duration = Date.now() - t0;

            this.#metrics.recordError(trackedUrl, normalized);
            if (circuitChecked) this.#circuitBreaker.recordFailure(trackedUrl);

            this.emit('request:error', { requestId, url: trackedUrl, error: normalized, duration: normalized.duration });
            await this.#plugins.runHook('onError', normalized);

            const handled = await this.#interceptors.runError(normalized);
            if (handled instanceof Error) throw handled;
            return handled as NeutrxResponse<TData>;
        } finally {
            this.#metrics.recordEnd();
        }
    }

    setBaseURL(url: string): this {
        this.#validateURL(url);
        this.#config = { ...this.#config, baseURL: url };
        return this;
    }

    setTimeout(ms: number): this {
        this.#config = { ...this.#config, timeout: ms };
        return this;
    }

    clearAuth(): this {
        delete this.#defaultHeaders.Authorization;
        return this;
    }

    clearCache(pattern?: string): this {
        this.#cache.clear(pattern);
        return this;
    }

    resetMetrics(): this {
        this.#metrics.reset();
        return this;
    }

    setHeader(key: string, value: Headers[string]): this {
        this.#validateHeaders({ [key]: value });
        this.#defaultHeaders[key] = value;
        return this;
    }

    removeHeader(key: string): this {
        delete this.#defaultHeaders[key];
        return this;
    }

    setAuth(auth: AuthConfig): this {
        if (auth.bearer) {
            this.#defaultHeaders.Authorization = `Bearer ${auth.bearer}`;
        } else if (auth.basic) {
            this.#defaultHeaders.Authorization = `Basic ${base64(`${auth.basic.username}:${auth.basic.password}`)}`;
        } else if (auth.apiKey) {
            this.#defaultHeaders[auth.apiKey.header ?? 'X-Api-Key'] = auth.apiKey.key;
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

    use(plugin: NeutrxPlugin): this {
        this.#plugins.use(plugin);
        return this;
    }

    addPluginHook(name: 'beforeRequest', hook: (context: InternalRequestConfig) => InternalRequestConfig | Promise<InternalRequestConfig>): void;
    addPluginHook(name: 'afterRequest', hook: (context: NeutrxResponse) => NeutrxResponse | Promise<NeutrxResponse>): void;
    addPluginHook(name: 'onError', hook: (context: Error) => Error | Promise<Error>): void;
    addPluginHook(
        name: 'beforeRequest' | 'afterRequest' | 'onError',
        hook:
            | ((context: InternalRequestConfig) => InternalRequestConfig | Promise<InternalRequestConfig>)
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

    getUri(config: string | RequestConfig): string {
        return this.#buildURL(typeof config === 'string' ? { url: config } : config);
    }

    create(config: ClientConfig = {}): BrowserClient {
        return new BrowserClient(mergeConfig(this.#config, config));
    }

    destroy(): void {
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

    async #fetch(config: InternalRequestConfig): Promise<RawHttpResponse> {
        const fetchImpl = config.fetch ?? globalThis.fetch;
        if (typeof fetchImpl !== 'function') {
            throw new NeutrxSecurityError('Fetch adapter requires globalThis.fetch', { code: 'FETCH_UNAVAILABLE' });
        }

        const runtimeConfig: RuntimeRequestConfig = { ...config, headers: { ...config.headers } };
        const body = bodyless(runtimeConfig.method) ? undefined : toFetchBody(runtimeConfig);
        injectXsrfHeader(runtimeConfig);
        const headers = toFetchHeaders(runtimeConfig.headers);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), runtimeConfig.timeout);
        const abort = (): void => controller.abort();
        runtimeConfig.signal?.addEventListener('abort', abort, { once: true });

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
            const data = runtimeConfig.responseType === 'stream'
                ? response.body
                : await readResponseData(response, runtimeConfig, total);

            return {
                status: response.status,
                statusText: response.statusText,
                headers: fromFetchHeaders(response.headers),
                data: data as RawHttpResponse['data'],
                config: runtimeConfig,
            } satisfies RawHttpResponse;
        } catch (error: unknown) {
            if (controller.signal.aborted) {
                throw new NeutrxError(`Request timeout or abort: ${runtimeConfig.url}`, {
                    code: 'REQUEST_ABORTED',
                    url: runtimeConfig.url,
                    method: runtimeConfig.method,
                    retryable: true,
                });
            }
            throw NeutrxErrorFactory.fromNodeError(normalizeError(error), runtimeConfig);
        } finally {
            clearTimeout(timeout);
            runtimeConfig.signal?.removeEventListener('abort', abort);
        }
    }

    #parse<TData extends ParsedResponseData>(raw: RawHttpResponse, config: InternalRequestConfig): NeutrxResponse<TData> {
        const parsed = parseResponseData(raw.data, config.responseType, raw.headers, config.responseEncoding, config.parseJson) as TData;
        const response: NeutrxResponse<TData> = {
            status: raw.status,
            statusText: raw.statusText,
            headers: raw.headers,
            data: applyResponseTransforms(parsed, raw.headers, raw.status, config.transformResponse) as TData,
            config,
            ...(raw.request ? { request: raw.request } : {}),
            timing: { duration: Date.now() - config.startTime },
            requestId: config.requestId,
            ...(raw.deduplicated ? { deduplicated: true } : {}),
        };

        if (config.throwHttpErrors && !config.validateStatus(raw.status)) {
            throw NeutrxErrorFactory.fromHTTPStatus(response);
        }

        return response;
    }

    #buildRC<TBody extends RequestBody>(config: RequestConfig<TBody>, requestId: string): InternalRequestConfig<TBody> {
        const method = normalizeMethod(config.method ?? 'GET');
        const headers = this.#buildHeaders(config, requestId);
        const transformedData = applyRequestTransforms(
            config.data,
            headers,
            mergeTransformRequest(this.#config.transformRequest, config.transformRequest)
        );

        if (transformedData !== undefined && !hasHeader(headers, 'Content-Type')) {
            const contentType = detectContentType(transformedData);
            if (contentType) headers['Content-Type'] = contentType;
        }

        const xsrfCookieName = config.xsrfCookieName !== undefined
            ? config.xsrfCookieName
            : this.#config.xsrfCookieName !== undefined ? this.#config.xsrfCookieName : 'XSRF-TOKEN';
        const xsrfHeaderName = config.xsrfHeaderName !== undefined
            ? config.xsrfHeaderName
            : this.#config.xsrfHeaderName !== undefined ? this.#config.xsrfHeaderName : 'X-XSRF-TOKEN';
        const requestConfig = {
            ...config,
            url: this.#buildURL(config),
            method,
            headers,
            timeout: config.timeout ?? this.#config.timeout,
            connectTimeout: config.connectTimeout ?? this.#config.connectTimeout,
            maxRedirects: config.maxRedirects ?? this.#config.maxRedirects,
            maxContentLength: config.maxContentLength ?? this.#config.maxContentLength,
            maxBodyLength: config.maxBodyLength ?? this.#config.maxBodyLength,
            responseType: config.responseType ?? 'json',
            responseEncoding: config.responseEncoding ?? 'utf8',
            validateStatus: config.validateStatus ?? this.#config.validateStatus,
            paramsSerializer: config.paramsSerializer ?? this.#config.paramsSerializer,
            formSerializer: config.formSerializer ?? this.#config.formSerializer,
            transformRequest: mergeTransformRequest(this.#config.transformRequest, config.transformRequest),
            transformResponse: mergeTransformResponse(this.#config.transformResponse, config.transformResponse),
            parseJson: config.parseJson ?? this.#config.parseJson,
            stringifyJson: config.stringifyJson ?? this.#config.stringifyJson,
            throwHttpErrors: config.throwHttpErrors ?? this.#config.throwHttpErrors,
            adapter: config.adapter ?? this.#config.adapter,
            fetch: config.fetch ?? this.#config.fetch,
            httpVersion: config.httpVersion ?? this.#config.httpVersion,
            http2Options: config.http2Options ?? this.#config.http2Options,
            withCredentials: config.withCredentials ?? this.#config.withCredentials,
            credentials: config.credentials ?? this.#config.credentials,
            xsrfCookieName,
            xsrfHeaderName,
            withXSRFToken: config.withXSRFToken ?? this.#config.withXSRFToken,
            instrumentation: config.instrumentation ?? this.#config.instrumentation,
            proxy: false,
            decompress: false,
            maxRate: config.maxRate ?? this.#config.maxRate,
            followRedirects: config.followRedirects !== false,
            requestId,
            startTime: Date.now(),
            hops: 0,
        };

        if (transformedData === undefined) {
            delete (requestConfig as { data?: RequestBody }).data;
        } else {
            (requestConfig as { data?: RequestBody }).data = transformedData;
        }

        return requestConfig as InternalRequestConfig<TBody>;
    }

    #buildURL(config: RequestConfig): string {
        let url = config.url;
        if (!/^https?:\/\//i.test(url)) {
            const base = config.baseURL ?? this.#config.baseURL ?? '';
            url = `${base.endsWith('/') ? base.slice(0, -1) : base}${url.startsWith('/') ? url : `/${url}`}`;
        }

        if (config.params && Object.keys(config.params).length > 0) {
            const parsed = new URL(url);
            const serializer = config.paramsSerializer ?? this.#config.paramsSerializer;
            const serialized = serializeParams(config.params, serializer);
            if (serialized) parsed.search = serialized.startsWith('?') ? serialized.slice(1) : serialized;
            url = parsed.toString();
        }

        return url;
    }

    #buildHeaders<TBody extends RequestBody>(config: RequestConfig<TBody>, requestId: string): Headers {
        return {
            ...this.#defaultHeaders,
            ...(this.#config.headers ?? {}),
            ...(config.headers ?? {}),
            'X-Request-ID': requestId,
        };
    }

    #buildDefaultHeaders(): Headers {
        return {
            Accept: 'application/json, text/plain, */*',
        };
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

    #validateHeaders(headers: Headers): void {
        const entries = Object.entries(headers);
        if (entries.length > MAX_HEADER_COUNT) {
            throw new NeutrxSecurityError(`Too many headers: ${entries.length}`, { code: 'TOO_MANY_HEADERS' });
        }

        let totalSize = 0;
        for (const [key, value] of entries) {
            if (!/^[a-zA-Z0-9\-_]+$/.test(key) || DANGEROUS_KEYS.has(key.toLowerCase())) {
                throw new NeutrxSecurityError(`Invalid header name: ${key}`, { code: 'INVALID_HEADER' });
            }

            const rendered = Array.isArray(value) ? value.join(',') : String(value);
            if (/[\r\n]/.test(`${key}${rendered}`)) {
                throw new NeutrxSecurityError(`Header injection detected: ${key}`, { code: 'HEADER_INJECTION' });
            }

            totalSize += key.length + rendered.length;
            if (totalSize > MAX_HEADER_SIZE) {
                throw new NeutrxSecurityError('Headers too large', { code: 'HEADERS_TOO_LARGE' });
            }
        }
    }

    #buildConfig(custom: ClientConfig): NormalizedClientConfig {
        const securityProfile = normalizeSecurityProfile(custom.security?.profile);
        return {
            timeout: custom.timeout ?? 30_000,
            connectTimeout: custom.connectTimeout ?? custom.timeout ?? 30_000,
            maxRedirects: custom.maxRedirects ?? 5,
            maxContentLength: custom.maxContentLength ?? 10 * 1024 * 1024,
            maxBodyLength: custom.maxBodyLength ?? 10 * 1024 * 1024,
            validateStatus: custom.validateStatus ?? ((status): boolean => status >= 200 && status < 300),
            throwHttpErrors: custom.throwHttpErrors ?? true,
            decompress: false,
            ...(custom.maxRate !== undefined ? { maxRate: custom.maxRate } : {}),
            ...(custom.baseURL ? { baseURL: custom.baseURL } : {}),
            ...(custom.headers ? { headers: custom.headers } : {}),
            ...(custom.paramsSerializer ? { paramsSerializer: custom.paramsSerializer } : {}),
            ...(custom.formSerializer ? { formSerializer: custom.formSerializer } : {}),
            ...(custom.transformRequest ? { transformRequest: normalizeArray(custom.transformRequest) } : {}),
            ...(custom.transformResponse ? { transformResponse: normalizeArray(custom.transformResponse) } : {}),
            ...(custom.parseJson ? { parseJson: custom.parseJson } : {}),
            ...(custom.stringifyJson ? { stringifyJson: custom.stringifyJson } : {}),
            adapter: custom.adapter ?? 'fetch',
            ...(custom.fetch ? { fetch: custom.fetch } : {}),
            ...(custom.withCredentials !== undefined ? { withCredentials: custom.withCredentials } : {}),
            ...(custom.credentials ? { credentials: custom.credentials } : {}),
            ...(custom.xsrfCookieName !== undefined ? { xsrfCookieName: custom.xsrfCookieName } : {}),
            ...(custom.xsrfHeaderName !== undefined ? { xsrfHeaderName: custom.xsrfHeaderName } : {}),
            ...(custom.withXSRFToken !== undefined ? { withXSRFToken: custom.withXSRFToken } : {}),
            ...(custom.instrumentation ? { instrumentation: custom.instrumentation } : {}),
            proxy: false,
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
            resilience: {
                enableCircuitBreaker: custom.resilience?.enableCircuitBreaker ?? true,
                failureThreshold: custom.resilience?.failureThreshold ?? 5,
                successThreshold: custom.resilience?.successThreshold ?? 2,
                circuitTimeout: custom.resilience?.circuitTimeout ?? 60_000,
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
                ...(custom.resilience?.shouldRetry ? { shouldRetry: custom.resilience.shouldRetry } : {}),
                ...(custom.resilience?.onRetry ? { onRetry: custom.resilience.onRetry } : {}),
            },
            performance: {
                enableCaching: custom.performance?.enableCaching ?? true,
                cacheMaxSize: custom.performance?.cacheMaxSize ?? 500,
                cacheTTL: custom.performance?.cacheTTL ?? 300_000,
                cacheMaxEntrySize: custom.performance?.cacheMaxEntrySize ?? 1_048_576,
                respectCacheHeaders: custom.performance?.respectCacheHeaders ?? true,
                deduplicateRequests: custom.performance?.deduplicateRequests ?? false,
                cacheStrategy: custom.performance?.cacheStrategy ?? 'ttl',
                cacheStaleMax: custom.performance?.cacheStaleMax ?? Math.max(custom.performance?.cacheTTL ?? 300_000, 1_500_000),
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

class BrowserCache {
    #store = new Map<string, { readonly response: NeutrxResponse; readonly createdAt: number; readonly expiresAt: number; lastAccessed: number; readonly size: number }>();
    #blocked = new Set<string>();
    #stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    #sweepTimer: ReturnType<typeof setInterval> | null = null;
    #enabled: boolean;
    #maxSize: number;
    #ttl: number;
    #maxEntrySize: number;
    #respectHeaders: boolean;

    constructor(config: NormalizedClientConfig['performance']) {
        this.#enabled = config.enableCaching;
        this.#maxSize = config.cacheMaxSize;
        this.#ttl = config.cacheTTL;
        this.#maxEntrySize = config.cacheMaxEntrySize;
        this.#respectHeaders = config.respectCacheHeaders;
        if (this.#enabled) {
            this.#sweepTimer = setInterval(() => this.#sweep(), 60_000);
            const maybeNodeTimer = this.#sweepTimer as { readonly unref?: () => void };
            maybeNodeTimer.unref?.();
        }
    }

    get(config: InternalRequestConfig): NeutrxResponse | null {
        if (!this.#enabled) return null;
        const key = this.#key(config);
        const entry = this.#store.get(key);
        if (!entry || Date.now() > entry.expiresAt) {
            if (entry) this.#store.delete(key);
            this.#stats.misses += 1;
            return null;
        }
        entry.lastAccessed = Date.now();
        this.#stats.hits += 1;
        return {
            ...entry.response,
            cached: true,
            cacheAge: Date.now() - entry.createdAt,
            headers: {
                ...entry.response.headers,
                'x-cache': 'HIT',
                'x-cache-age': String(Math.floor((Date.now() - entry.createdAt) / 1000)),
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
        this.#store.set(this.#key(config), {
            response: { ...response },
            createdAt: Date.now(),
            expiresAt: Date.now() + ttl,
            lastAccessed: Date.now(),
            size,
        });
        this.#stats.sets += 1;
    }

    clear(pattern?: string): void {
        if (!pattern) {
            this.#store.clear();
            return;
        }
        const expression = new RegExp(pattern);
        for (const key of this.#store.keys()) {
            if (expression.test(key)) this.#store.delete(key);
        }
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
            if (now > value.expiresAt) this.#store.delete(key);
        }
    }
}

class BrowserMetrics {
    #requests: BrowserRequestMetrics = { total: 0, active: 0, success: 0, errors: 0, cached: 0, retried: 0 };
    #durations: number[] = [];
    #byStatus: Record<string, number> = {};
    #errors: BrowserErrorMetrics = { byType: {}, byCode: {} };

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

    recordError(_url: string, error: Error & { readonly code?: string }): void {
        this.#requests.errors += 1;
        this.#requests.total += 1;
        this.#inc(this.#errors.byType, error.name);
        this.#inc(this.#errors.byCode, error.code ?? 'UNKNOWN');
    }

    recordCacheHit(): void {
        this.#requests.cached += 1;
        this.#requests.total += 1;
    }

    recordRetry(): void {
        this.#requests.retried += 1;
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
        const { total, success, errors, cached } = this.#requests;
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
            '',
            '# TYPE neutrx_active_requests gauge',
            `neutrx_active_requests ${this.#requests.active}`,
        ].join('\n');
    }

    reset(): void {
        this.#requests = { total: 0, active: 0, success: 0, errors: 0, cached: 0, retried: 0 };
        this.#durations = [];
        this.#byStatus = {};
        this.#errors = { byType: {}, byCode: {} };
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
    headers: Headers,
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
    for (const [key, value] of Object.entries(params)) appendSearchParam(encoded, key, value, serializer?.encode);
    return encoded.toString();
}

function appendSearchParam(params: URLSearchParams, key: string, value: QueryValue, encode?: (value: string) => string): void {
    if (value == null) return;
    const encodedKey = encode ? encode(key) : key;
    if (Array.isArray(value)) {
        value.forEach(item => params.append(encodedKey, encode ? encode(String(item)) : String(item)));
        return;
    }
    params.set(encodedKey, encode ? encode(String(value)) : String(value));
}

function toFetchBody(config: RuntimeRequestConfig): FetchBody | undefined {
    const data = config.data;
    if (data === undefined) return undefined;
    if (typeof data === 'string') {
        reportUploadProgress(config, byteLength(data), byteLength(data));
        return data;
    }
    if (data instanceof ArrayBuffer) {
        reportUploadProgress(config, data.byteLength, data.byteLength);
        return data;
    }
    if (ArrayBuffer.isView(data)) {
        reportUploadProgress(config, data.byteLength, data.byteLength);
        return data;
    }
    if (data instanceof URLSearchParams) {
        const rendered = data.toString();
        reportUploadProgress(config, byteLength(rendered), byteLength(rendered));
        return data;
    }
    if (isBlobLike(data)) {
        reportUploadProgress(config, data.size, data.size);
        return data;
    }
    if (isFormDataLike(data)) return data;
    if (isStreamLike(data)) return data as FetchBody;

    const rendered = (config.stringifyJson ?? JSON.stringify)(data);
    reportUploadProgress(config, byteLength(rendered), byteLength(rendered));
    return rendered as FetchBody;
}

function toFetchHeaders(headers: Headers): globalThis.Headers {
    const next = new globalThis.Headers();
    for (const [key, value] of Object.entries(headers)) next.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    return next;
}

function injectXsrfHeader(config: RuntimeRequestConfig): void {
    if (!isStandardBrowserEnvironment() || !config.xsrfCookieName || !config.xsrfHeaderName) return;
    const shouldInject = typeof config.withXSRFToken === 'function'
        ? config.withXSRFToken(config)
        : config.withXSRFToken === true || (config.withXSRFToken !== false && isSameOrigin(config.url));
    if (!shouldInject) return;
    const token = readCookie(config.xsrfCookieName);
    if (token) config.headers[config.xsrfHeaderName] = token;
}

function credentialsFor(withCredentials: boolean | undefined, credentials: RuntimeRequestConfig['credentials']): FetchCredentials {
    if (credentials) return credentials;
    if (withCredentials === true) return 'include';
    if (withCredentials === false) return 'omit';
    return 'same-origin';
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
    if (config.responseType === 'stream') return response.body;

    if (!response.body || !config.onDownloadProgress) {
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

function hasHeader(headers: Headers, key: string): boolean {
    const lower = key.toLowerCase();
    return Object.keys(headers).some(header => header.toLowerCase() === lower);
}

function headerToString(value: Headers[string] | undefined): string {
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
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

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function rejectAfter(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(message)), ms);
    });
}

function mergeConfig(base: NormalizedClientConfig, override: ClientConfig): ClientConfig {
    const overrideProfile = override.security?.profile === undefined
        ? undefined
        : normalizeSecurityProfile(override.security.profile);
    const security = overrideProfile && overrideProfile !== base.security.profile
        ? { ...override.security, profile: overrideProfile }
        : { ...base.security, ...(override.security ?? {}), ...(overrideProfile ? { profile: overrideProfile } : {}) };

    return {
        ...base,
        ...override,
        security,
        resilience: { ...base.resilience, ...(override.resilience ?? {}) },
        performance: { ...base.performance, ...(override.performance ?? {}) },
    };
}
