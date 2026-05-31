import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

import SecurityManager from '../security/SecurityManager.js';
import { RateLimiter } from '../security/RateLimiter.js';
import InterceptorChain, { type NeutrxInterceptors } from '../interceptors/InterceptorChain.js';
import CircuitBreaker from '../resilience/CircuitBreaker.js';
import { RetryEngine } from '../resilience/RetryEngine.js';
import Bulkhead from '../resilience/Bulkhead.js';
import CacheEngine from '../performance/CacheEngine.js';
import MetricsCollector from '../monitoring/MetricsCollector.js';
import type { MetricsSnapshot } from '../monitoring/MetricsCollector.js';
import { PluginManager, type NeutrxPlugin } from '../plugins/PluginManager.js';
import { fetchAdapter } from '../adapters/fetch.js';
import { http2Adapter, closeHttp2Sessions } from '../adapters/http2.js';
import { createNodeHttpAgents, nodeHttpAdapter, type NodeHttpAdapterAgents } from '../adapters/http.js';
import { OpenTelemetryInstrumentation } from '../monitoring/OpenTelemetryInstrumentation.js';
import { VERSION } from '../version.js';

import {
    NeutrxErrorFactory,
    NeutrxSecurityError,
} from './NeutrxError.js';
import {
    applyRequestTransforms,
    applyResponseTransforms,
    buildConfig,
    buildURL,
    detectAdapter,
    mergeConfig,
    mergeTransformRequest,
    mergeTransformResponse,
    normalizeMethod,
    resolveServiceEndpoint,
    type ServiceDiscoveryState,
} from './config.js';
import { createMutableDefaults, defaultsToConfig, type NeutrxDefaults } from './defaults.js';
import { detectContentType } from './bodySerializer.js';
import { mergeCancellationSignal } from './cancel.js';
import { NeutrxHeaders, hasHeader } from './headers.js';
import { REDIRECT_CODES, buildRedirectContext, shouldRedirectWithGet, stripRedirectHeaders, withoutBody } from './redirect.js';
import { decompressResponseData, normalizeNodeResponseData, parseResponseData } from './responseParser.js';
import { validateResponseData } from './validation.js';
import type {
    AuthConfig,
    BulkheadStats,
    CacheStats,
    CertificatePinConfig,
    CircuitStatus,
    ClientConfig,
    ConcurrentOptions,
    ConcurrentResult,
    EgressPolicyAudit,
    GraphQLResult,
    HeaderSource,
    Headers,
    HttpMethod,
    InternalHeaders,
    InstrumentationConfig,
    InternalRequestConfig,
    JsonValue,
    MockController,
    NeutrxLogger,
    NeutrxResponse,
    NeutrxWebSocketOptions,
    NeutrxWSConnection,
    NormalizedClientConfig,
    OAuth2Config,
    PaginationOptions,
    PaginationPage,
    ParsedResponseData,
    RawHttpResponse,
    RequestAdapter,
    RequestBody,
    RequestConfig,
    ResponseSchemaOption,
    RetryContext,
    SchemaResponseData,
    SseHandle,
    ValidationPluginConfig,
} from '../types.js';

type BodylessRequestConfig<TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined> = Omit<RequestConfig<RequestBody, TSchema>, 'url' | 'method' | 'data'>;
type BodyRequestConfig<
    TBody extends RequestBody,
    TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
> = Omit<RequestConfig<TBody, TSchema>, 'url' | 'method' | 'data'>;
type BeforeRequestResult = Omit<InternalRequestConfig, 'headers'> & { readonly headers: HeaderSource };

export default class NeutrxClient extends EventEmitter {
    configureOAuth2?: (config: OAuth2Config) => void;
    configureValidation?: (config: ValidationPluginConfig) => void;
    gql?: <TData extends JsonValue = JsonValue>(
        endpoint: string,
        query: string,
        variables?: Record<string, JsonValue>,
        options?: { readonly operationName?: string; readonly headers?: Headers }
    ) => Promise<GraphQLResult<TData>>;
    mock?: MockController;
    ws?: (url: string, options?: NeutrxWebSocketOptions) => NeutrxWSConnection;
    logger: NeutrxLogger | undefined = undefined;
    readonly defaults: NeutrxDefaults;
    readonly interceptors: NeutrxInterceptors;

    #config: NormalizedClientConfig;
    #security: SecurityManager;
    #interceptors: InterceptorChain;
    #circuitBreaker: CircuitBreaker;
    #retryEngine: RetryEngine;
    #bulkhead: Bulkhead;
    #cache: CacheEngine;
    #metrics: MetricsCollector;
    #rateLimiter: RateLimiter;
    #plugins: PluginManager;
    #otel: OpenTelemetryInstrumentation;
    #defaultHeaders: InternalHeaders;
    #agents: NodeHttpAdapterAgents;
    #inflight = new Map<string, Promise<RawHttpResponse>>();
    #serviceDiscovery: ServiceDiscoveryState = { counters: new Map<string, number>() };

    constructor(config: ClientConfig = {}) {
        super();
        this.#config = buildConfig(config);
        this.defaults = createMutableDefaults(this.#config);
        this.#security = new SecurityManager({ ...this.#config.security, ...(this.#config.egressPolicy ? { egressPolicy: this.#config.egressPolicy } : {}) });
        if (this.#config.tls?.certificatePins) this.#security.setCertificatePins(this.#config.tls.certificatePins);
        this.#interceptors = new InterceptorChain();
        this.#circuitBreaker = new CircuitBreaker(this.#config.resilience);
        this.#retryEngine = new RetryEngine(this.#config.resilience);
        this.#bulkhead = new Bulkhead(this.#config.resilience);
        this.#cache = new CacheEngine(this.#config.performance);
        this.#metrics = new MetricsCollector();
        this.#rateLimiter = new RateLimiter(this.#config.security.rateLimit ?? {});
        this.#plugins = new PluginManager(this);
        this.#otel = new OpenTelemetryInstrumentation();
        this.#defaultHeaders = this.#buildDefaultHeaders();
        this.#agents = createNodeHttpAgents();
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

    postForm<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.post<TData, TBody, TSchema>(url, data, withMultipartHeaders(config));
    }

    postUrlEncoded<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.post<TData, TBody, TSchema>(url, data, withUrlEncodedHeaders(config));
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

    putForm<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.put<TData, TBody, TSchema>(url, data, withMultipartHeaders(config));
    }

    putUrlEncoded<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.put<TData, TBody, TSchema>(url, data, withUrlEncodedHeaders(config));
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

    patchForm<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.patch<TData, TBody, TSchema>(url, data, withMultipartHeaders(config));
    }

    patchUrlEncoded<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> {
        return this.patch<TData, TBody, TSchema>(url, data, withUrlEncodedHeaders(config));
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
    ): Promise<NeutrxResponse<SchemaResponseData<Buffer, TSchema>>> {
        return this.request<Buffer, RequestBody, TSchema>({ ...config, method: 'GET', url, responseType: 'buffer' });
    }

    async sse(url: string, { onMessage, onError, onClose }: {
        readonly onMessage?: (message: JsonValue | string) => void;
        readonly onError?: (error: Error) => void;
        readonly onClose?: () => void;
    } = {}): Promise<SseHandle> {
        const response = await this.request<IncomingMessage>({
            url,
            method: 'GET',
            responseType: 'stream',
            headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
        });

        response.data.on('data', chunk => {
            const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            for (const block of text.split('\n\n')) {
                if (!block.startsWith('data: ')) continue;
                const payload = block.slice(6);
                try {
                    onMessage?.(JSON.parse(payload) as JsonValue);
                } catch {
                    onMessage?.(payload);
                }
            }
        });

        response.data.on('error', error => onError?.(normalizeError(error)));
        response.data.on('close', () => onClose?.());
        return { close: () => response.data.destroy() };
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
        let span: Awaited<ReturnType<OpenTelemetryInstrumentation['start']>>['span'] = null;
        let retryCount = 0;
        this.#metrics.recordStart();

        try {
            let rc: InternalRequestConfig = await this.#buildRC(config, requestId);
            trackedUrl = rc.url;
            const telemetry = await this.#otel.start(rc);
            span = telemetry.span;
            if (Object.keys(telemetry.carrier).length > 0) {
                rc = { ...rc, headers: toInternalHeaders(NeutrxHeaders.from(rc.headers).concat(telemetry.carrier)) };
            }

            rc = toInternalRequestConfig(await this.#plugins.runHook('beforeRequest', rc));
            if (rc.mockResponse) {
                const response = rc.mockResponse as NeutrxResponse<TData>;
                this.#otel.finish(span, response, {
                    retries: 0,
                    cacheHit: false,
                    durationMs: Date.now() - t0,
                    circuitState: this.#circuitState(rc.url),
                });
                return response as NeutrxResponse<SchemaResponseData<TData, TSchema>>;
            }
            trackedUrl = rc.url;

            rc = toInternalRequestConfig(this.#security.validateRequest(rc));
            this.#rateLimiter.checkLimit(rc.url);
            trackedUrl = rc.url;

            rc = toInternalRequestConfig(await this.#interceptors.runRequest(rc));
            trackedUrl = rc.url;

            if (this.#isCacheEligible(rc)) {
                cacheConfig = rc;
                const hit = this.#cache.getWithState(rc);
                if (hit) {
                    this.#metrics.recordCacheHit(rc.url);
                    this.emit('cache:hit', { requestId, url: rc.url, state: hit.state });
                    if (hit.state === 'stale') this.#revalidateCache(rc);
                    this.#otel.finish(span, hit.response as NeutrxResponse<TData>, {
                        retries: 0,
                        cacheHit: true,
                        durationMs: Date.now() - t0,
                        circuitState: this.#circuitState(rc.url),
                    });
                    return hit.response as NeutrxResponse<SchemaResponseData<TData, TSchema>>;
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
                    retryCount = attempt;
                    if (attempt > 0) this.#metrics.recordRetry(rc.url, attempt);
                    const raw = await this.#bulkhead.execute(domain, () => this.#dispatchDeduped(rc));
                    return this.#parse<TData>(raw, rc);
                },
                retryContext
            );

            response.attempts = attempts;
            let next: NeutrxResponse = this.#security.sanitizeResponse(response);
            next = await this.#interceptors.runResponse(next);
            next = await this.#plugins.runHook('afterRequest', next);

            if (this.#isCacheEligible(rc)) {
                this.#cache.set(rc, next);
            }

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

            this.#otel.finish(span, next as NeutrxResponse<TData>, {
                retries: Math.max(0, attempts.length - 1),
                cacheHit: false,
                durationMs: duration,
                circuitState: this.#circuitState(rc.url),
            });
            return next as NeutrxResponse<SchemaResponseData<TData, TSchema>>;
        } catch (error: unknown) {
            const normalized = normalizeError(error) as Error & { requestId?: string; duration?: number; code?: string };
            normalized.requestId = requestId;
            normalized.duration = Date.now() - t0;
            if (cacheConfig) {
                const stale = this.#cache.getStaleIfError(cacheConfig);
                if (stale) {
                    this.#metrics.recordCacheHit(cacheConfig.url);
                    this.emit('cache:stale-if-error', { requestId, url: cacheConfig.url, error: normalized });
                    this.#otel.finish(span, stale as NeutrxResponse<TData>, {
                        retries: retryCount,
                        cacheHit: true,
                        durationMs: normalized.duration,
                        circuitState: this.#circuitState(cacheConfig.url),
                    });
                    return stale as NeutrxResponse<SchemaResponseData<TData, TSchema>>;
                }
            }

            this.#metrics.recordError(trackedUrl, normalized);
            if (circuitChecked) await this.#circuitBreaker.recordFailure(trackedUrl);
            this.#otel.fail(span, normalized, {
                retries: retryCount,
                durationMs: normalized.duration,
                circuitState: this.#circuitState(trackedUrl),
            });

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
        this.#security.validateURL(url);
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
        this.#defaultHeaders = toInternalHeaders(NeutrxHeaders.from(this.#defaultHeaders).removeAuthorization());
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
        this.#security.validateHeader(key, value);
        this.#defaultHeaders = toInternalHeaders(NeutrxHeaders.from(this.#defaultHeaders).set(key, value));
        return this;
    }

    removeHeader(key: string): this {
        const headers = NeutrxHeaders.from(this.#defaultHeaders);
        headers.delete(key);
        this.#defaultHeaders = toInternalHeaders(headers);
        return this;
    }

    setAuth(auth: AuthConfig): this {
        const headers = NeutrxHeaders.from(this.#defaultHeaders);
        if (auth.bearer) {
            headers.setBearerAuth(auth.bearer);
        } else if (auth.basic) {
            headers.setAuthorization(`Basic ${Buffer.from(`${auth.basic.username}:${auth.basic.password}`).toString('base64')}`);
        } else if (auth.apiKey) {
            headers.set(auth.apiKey.header ?? 'X-Api-Key', auth.apiKey.key);
        }
        this.#defaultHeaders = toInternalHeaders(headers);
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

    pinCertificate(host: string, fingerprint: string, window?: Omit<CertificatePinConfig, 'hostname' | 'sha256'>): this {
        this.#security.pinCertificate(host, fingerprint, window);
        return this;
    }

    blockDomain(domain: string): this {
        this.#security.blockDomain(domain);
        return this;
    }

    enableRequestSigning(secret: string, algorithm?: string): this {
        this.#security.enableSigning(secret, algorithm);
        return this;
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

    getMetrics(): MetricsSnapshot {
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
        return this.#security.getEgressPolicyAudit();
    }

    getUri(config: string | RequestConfig): string {
        const requestConfig = typeof config === 'string' ? { url: config } : config;
        return buildURL(requestConfig, this.#configWithDefaults(requestConfig.method));
    }

    create(config: ClientConfig = {}): NeutrxClient {
        return new NeutrxClient(mergeConfig(this.#configWithDefaults(), config));
    }

    destroy(): void {
        this.#agents.http.destroy();
        this.#agents.https.destroy();
        closeHttp2Sessions();
        this.#cache.destroy();
        this.#metrics.destroy();
        this.removeAllListeners();
    }

    async #dispatch(config: InternalRequestConfig): Promise<RawHttpResponse> {
        const adapter = config.adapter ?? this.#config.adapter ?? detectAdapter(config);
        const selectedAdapter: unknown = adapter;
        let dispatch: RequestAdapter;
        if (typeof adapter === 'function') {
            dispatch = adapter;
        } else if (adapter === 'fetch') {
            dispatch = fetchAdapter;
        } else if (adapter === 'http2') {
            dispatch = http2Adapter;
        } else if (adapter === 'http') {
            dispatch = requestConfig => nodeHttpAdapter(requestConfig, {
                security: this.#security,
                defaults: this.#configWithDefaults(requestConfig.method),
                agents: this.#agents,
            });
        } else {
            throw new NeutrxSecurityError(`Unknown adapter: ${String(selectedAdapter)}`, { code: 'UNKNOWN_ADAPTER' });
        }

        return this.#dispatchWithRedirects(config, dispatch);
    }

    async #dispatchWithRedirects(config: InternalRequestConfig, adapter: RequestAdapter): Promise<RawHttpResponse> {
        const raw = await adapter(config);
        if (!REDIRECT_CODES.has(raw.status) || !config.followRedirects) return raw;

        const hops = config.hops + 1;
        if (hops > config.maxRedirects) throw new Error('Max redirects exceeded');

        const location = singleHeaderValue(headerValue(raw.headers, 'location'));
        if (!location) throw new Error('Redirect response missing Location header');
        const redirectUrl = new URL(location, config.url).href;
        if (config.socketPath) {
            this.#security.validateSocketURL(redirectUrl);
        } else {
            this.#security.validateURL(redirectUrl);
            this.#security.validateRedirect(config.url, redirectUrl);
        }
        discardRedirectBody(raw.data);

        const redirectedMethod = shouldRedirectWithGet(raw.status, config.method) ? 'GET' : config.method;
        const headers = stripRedirectHeaders(config.headers, config.url, redirectUrl, redirectedMethod !== config.method);
        const redirectedConfig = redirectedMethod === 'GET'
            ? withoutBody({ ...config, url: redirectUrl, method: redirectedMethod, headers, hops })
            : { ...config, url: redirectUrl, method: redirectedMethod, headers, hops };

        await config.beforeRedirect?.(buildRedirectContext(raw.status, location, config.url, redirectUrl, redirectedConfig.headers));
        return this.#dispatchWithRedirects(redirectedConfig, adapter);
    }

    async #dispatchDeduped(config: InternalRequestConfig): Promise<RawHttpResponse> {
        if (!this.#isDeduplicationEligible(config)) return this.#dispatch(config);

        const key = this.#dedupeKey(config);
        const existing = this.#inflight.get(key);
        if (existing) {
            this.emit('request:deduplicated', { requestId: config.requestId, url: config.url, method: config.method });
            const raw = await existing;
            return { ...raw, config, data: cloneRawData(raw.data), deduplicated: true };
        }

        const pending = this.#dispatch(config);
        this.#inflight.set(key, pending);
        try {
            const raw = await pending;
            return { ...raw, data: cloneRawData(raw.data) };
        } finally {
            this.#inflight.delete(key);
        }
    }

    #revalidateCache(config: InternalRequestConfig): void {
        if (!this.#cache.markRevalidating(config)) return;
        const conditionalHeaders = this.#cache.revalidationHeaders(config);
        const revalidationConfig = withoutSignal({
            ...config,
            headers: toInternalHeaders(NeutrxHeaders.concat(config.headers, conditionalHeaders)),
            requestId: this.#id(),
            startTime: Date.now(),
            cache: false,
        });

        void (async (): Promise<void> => {
            try {
                const raw = await this.#dispatchDeduped(revalidationConfig);
                if (raw.status === 304) {
                    this.#cache.refresh(config, raw.headers);
                    this.emit('cache:revalidated', { requestId: revalidationConfig.requestId, url: config.url, status: 304 });
                    return;
                }
                const parsed = await this.#parse(raw, revalidationConfig);
                let next: NeutrxResponse = this.#security.sanitizeResponse(parsed);
                next = await this.#interceptors.runResponse(next);
                next = await this.#plugins.runHook('afterRequest', next);
                this.#cache.set(config, next);
                this.emit('cache:revalidated', { requestId: revalidationConfig.requestId, url: config.url });
            } catch (error: unknown) {
                this.emit('cache:revalidate:error', { requestId: revalidationConfig.requestId, url: config.url, error: normalizeError(error) });
            } finally {
                this.#cache.finishRevalidating(config);
            }
        })();
    }

    async #parse<TData extends ParsedResponseData>(raw: RawHttpResponse, config: InternalRequestConfig): Promise<NeutrxResponse<TData>> {
        let data = normalizeNodeResponseData(raw.data);
        if (Buffer.isBuffer(data) || isIncomingMessageLike(data)) {
            data = await decompressResponseData(data, raw.headers, config.decompress, config.maxContentLength);
        }

        const parsed = parseResponseData(data, config.responseType, raw.headers, config.responseEncoding, config.parseJson) as TData;
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
        const xsrfCookieName = config.xsrfCookieName !== undefined
            ? config.xsrfCookieName
            : defaults.xsrfCookieName !== undefined ? defaults.xsrfCookieName : 'XSRF-TOKEN';
        const xsrfHeaderName = config.xsrfHeaderName !== undefined
            ? config.xsrfHeaderName
            : defaults.xsrfHeaderName !== undefined ? defaults.xsrfHeaderName : 'X-XSRF-TOKEN';
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

        const requestConfig = {
            ...config,
            url: buildURL(urlConfig, defaults),
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
            proxy: config.proxy ?? defaults.proxy,
            tls: config.tls ?? defaults.tls,
            beforeRedirect: config.beforeRedirect ?? defaults.beforeRedirect,
            httpAgent: config.httpAgent ?? defaults.httpAgent,
            httpsAgent: config.httpsAgent ?? defaults.httpsAgent,
            lookup: config.lookup ?? defaults.lookup,
            socketPath: config.socketPath ?? defaults.socketPath,
            decompress: config.decompress ?? defaults.decompress,
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
        validateSocketPath(requestConfig.socketPath);

        return requestConfig as InternalRequestConfig<TBody>;
    }

    #buildHeaders<TBody extends RequestBody>(
        config: RequestConfig<TBody>,
        defaults: NormalizedClientConfig,
        requestId: string,
        idempotencyKey?: string,
        idempotencyKeyHeader = 'Idempotency-Key'
    ): InternalHeaders {
        const headers = NeutrxHeaders.concat(this.#defaultHeaders, defaults.headers, config.headers);
        headers.setIfNotBlocked('X-Request-ID', requestId);
        if (idempotencyKey) headers.setIfNotBlocked(idempotencyKeyHeader, idempotencyKey);
        const auth = config.auth ?? defaults.auth;
        if (auth) {
            headers.setIfNotBlocked('Authorization', `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`);
        }
        return toInternalHeaders(headers);
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
        return buildConfig(mergeConfig(this.#config, defaultsToConfig(this.defaults, method, { rejectUnsafe: true })));
    }

    #buildDefaultHeaders(): InternalHeaders {
        return toInternalHeaders({
            'User-Agent': `neutrx/${VERSION} Node.js/${process.version}`,
            Accept: 'application/json, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate, br',
            Connection: 'keep-alive',
        });
    }

    #isCacheEligible(config: InternalRequestConfig): boolean {
        return (config.method === 'GET' || config.method === 'HEAD') && config.cache !== false && config.responseType !== 'stream';
    }

    #isDeduplicationEligible(config: InternalRequestConfig): boolean {
        return this.#config.performance.deduplicateRequests
            && this.#isCacheEligible(config)
            && typeof (config.adapter ?? this.#config.adapter) !== 'function';
    }

    #dedupeKey(config: InternalRequestConfig): string {
        return JSON.stringify({
            method: config.method,
            socketPath: config.socketPath ?? '',
            url: config.url,
            responseType: config.responseType,
            accept: config.headers.Accept ?? config.headers.accept ?? '',
            authorization: config.headers.Authorization ?? config.headers.authorization ?? '',
            adapter: config.adapter ?? this.#config.adapter ?? detectAdapter(config),
        });
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

    #circuitState(url: string): CircuitStatus['state'] {
        const status = this.#circuitBreaker.getStatus(url);
        return 'state' in status && typeof status.state === 'string' ? status.state : 'CLOSED';
    }
}

function isIncomingMessageLike(data: unknown): data is IncomingMessage {
    return data !== null
        && typeof data === 'object'
        && 'pipe' in data;
}

function cloneRawData(data: RawHttpResponse['data']): RawHttpResponse['data'] {
    if (Buffer.isBuffer(data)) return Buffer.from(data);
    if (data instanceof ArrayBuffer) return data.slice(0);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return data;
}

function withoutSignal(config: InternalRequestConfig): InternalRequestConfig {
    const copy = { ...config } as { cancelToken?: unknown; signal?: AbortSignal };
    delete copy.signal;
    delete copy.cancelToken;
    return copy as InternalRequestConfig;
}

function dig(value: ParsedResponseData, path: string): ParsedResponseData {
    return path.split('.').reduce<ParsedResponseData>((current, key) => {
        if (current !== null && typeof current === 'object' && !Buffer.isBuffer(current) && !(current instanceof Readable) && key in current) {
            const indexed = current as Record<string, ParsedResponseData>;
            return indexed[key] ?? null;
        }
        return null;
    }, value);
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
}

function withMultipartHeaders<TBody extends RequestBody, TSchema extends ResponseSchemaOption | undefined>(
    config: BodyRequestConfig<TBody, TSchema>
): BodyRequestConfig<TBody, TSchema> {
    return {
        ...config,
        headers: NeutrxHeaders.concat({ 'Content-Type': 'multipart/form-data' }, config.headers),
    };
}

function withUrlEncodedHeaders<TBody extends RequestBody, TSchema extends ResponseSchemaOption | undefined>(
    config: BodyRequestConfig<TBody, TSchema>
): BodyRequestConfig<TBody, TSchema> {
    return {
        ...config,
        headers: NeutrxHeaders.concat({ 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, config.headers),
    };
}

function toInternalHeaders(headers: Headers | NeutrxHeaders): InternalHeaders {
    return NeutrxHeaders.from(headers) as unknown as InternalHeaders;
}

function toInternalRequestConfig<TBody extends RequestBody>(config: InternalRequestConfig<TBody>): InternalRequestConfig<TBody> {
    return {
        ...config,
        headers: toInternalHeaders(config.headers),
    };
}

function validateSocketPath(socketPath: string | undefined): void {
    if (socketPath === undefined) return;
    if (/[\0\r\n]/u.test(socketPath)) {
        throw new NeutrxSecurityError('socketPath contains unsafe characters', { code: 'INVALID_SOCKET_PATH' });
    }
    if (socketPath.startsWith('/') || socketPath.startsWith('\\\\.\\pipe\\') || socketPath.startsWith('\\\\?\\pipe\\')) return;
    throw new NeutrxSecurityError('socketPath must be an absolute local path', { code: 'INVALID_SOCKET_PATH' });
}

function singleHeaderValue(value: Headers[string] | undefined): string | undefined {
    if (value == null) return undefined;
    if (Array.isArray(value)) {
        const first: unknown = value[0];
        if (typeof first === 'string' || typeof first === 'number' || typeof first === 'boolean') return String(first);
        return undefined;
    }
    return String(value);
}

function headerValue(headers: Headers, name: string): Headers[string] | undefined {
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lowerName) return value;
    }
    return undefined;
}

function discardRedirectBody(data: RawHttpResponse['data']): void {
    if (isIncomingMessageLike(data)) {
        data.resume();
        return;
    }
    if (typeof ReadableStream !== 'undefined' && data instanceof ReadableStream) {
        void data.cancel().catch(() => undefined);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

