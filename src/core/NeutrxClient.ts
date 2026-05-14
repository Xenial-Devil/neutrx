import http, { type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import https from 'node:https';
import type { PeerCertificate } from 'node:tls';
import { Readable } from 'node:stream';
import type { Duplex } from 'node:stream';
import { EventEmitter } from 'node:events';

import SecurityManager from '../security/SecurityManager.js';
import { RateLimiter } from '../security/RateLimiter.js';
import InterceptorChain, { type AxiosInterceptors } from '../interceptors/InterceptorChain.js';
import CircuitBreaker from '../resilience/CircuitBreaker.js';
import { RetryEngine } from '../resilience/RetryEngine.js';
import Bulkhead from '../resilience/Bulkhead.js';
import CacheEngine from '../performance/CacheEngine.js';
import MetricsCollector from '../monitoring/MetricsCollector.js';
import type { MetricsSnapshot } from '../monitoring/MetricsCollector.js';
import { PluginManager, type NeutrxPlugin } from '../plugins/PluginManager.js';
import { fetchAdapter } from '../adapters/fetch.js';
import { http2Adapter, closeHttp2Sessions } from '../adapters/http2.js';
import { OpenTelemetryInstrumentation } from '../monitoring/OpenTelemetryInstrumentation.js';

import {
    NeutrxConnectTimeoutError,
    NeutrxError,
    NeutrxErrorFactory,
    NeutrxRequestSizeError,
    NeutrxResponseSizeError,
    NeutrxSecurityError,
    NeutrxResponseTimeoutError,
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
} from './config.js';
import { detectContentType, serializeBody } from './bodySerializer.js';
import { createHttpsProxyConnection, directRequestTarget, proxyRequestTarget, resolveProxy } from './proxy.js';
import { createLookup, validateProxyTarget } from './dns.js';
import { NeutrxHeaders, getContentLength, hasHeader, normalizeIncomingHeaders, setHeader, toOutgoingHeaders } from './headers.js';
import { attachStreamDownloadProgress, reportDownloadProgress, reportUploadProgress, toUploadBuffer } from './progress.js';
import { REDIRECT_CODES, buildRedirectContext, shouldRedirectWithGet, stripRedirectHeaders, withoutBody } from './redirect.js';
import { decompressResponseData, normalizeNodeResponseData, parseResponseData } from './responseParser.js';
import type {
    AuthConfig,
    BulkheadStats,
    CacheStats,
    CircuitStatus,
    ClientConfig,
    ConcurrentOptions,
    ConcurrentResult,
    GraphQLResult,
    Headers,
    InternalRequestConfig,
    JsonValue,
    MockController,
    NeutrxResponse,
    NormalizedClientConfig,
    OAuth2Config,
    PaginationOptions,
    PaginationPage,
    ParsedResponseData,
    RawHttpResponse,
    RequestBody,
    RequestConfig,
    SseHandle,
} from '../types.js';

const SECURE_CIPHERS = [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256',
].join(':');

type BodylessRequestConfig = Omit<RequestConfig, 'url' | 'method' | 'data'>;
type BodyRequestConfig<TBody extends RequestBody> = Omit<RequestConfig<TBody>, 'url' | 'method' | 'data'>;
type RuntimeRequestConfig = InternalRequestConfig & { headers: Headers };

export default class NeutrxClient extends EventEmitter {
    configureOAuth2?: (config: OAuth2Config) => void;
    gql?: <TData extends JsonValue = JsonValue>(
        endpoint: string,
        query: string,
        variables?: Record<string, JsonValue>,
        options?: { readonly operationName?: string; readonly headers?: Headers }
    ) => Promise<GraphQLResult<TData>>;
    mock?: MockController;
    readonly interceptors: AxiosInterceptors;

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
    #defaultHeaders: Headers;
    #agents: { http: http.Agent; https: https.Agent };

    constructor(config: ClientConfig = {}) {
        super();
        this.#config = buildConfig(config);
        this.#security = new SecurityManager(this.#config.security);
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
        this.#agents = this.#setupAgents();
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

    put<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody> = {}
    ): Promise<NeutrxResponse<TData>> {
        return this.request<TData, TBody>({ ...config, method: 'PUT', url, data });
    }

    patch<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        url: string,
        data: TBody,
        config: BodyRequestConfig<TBody> = {}
    ): Promise<NeutrxResponse<TData>> {
        return this.request<TData, TBody>({ ...config, method: 'PATCH', url, data });
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

    download(url: string, config: BodylessRequestConfig = {}): Promise<NeutrxResponse<Buffer>> {
        return this.request<Buffer>({ ...config, method: 'GET', url, responseType: 'buffer' });
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

    async request<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        config: RequestConfig<TBody>
    ): Promise<NeutrxResponse<TData>> {
        const requestId = this.#id();
        const t0 = Date.now();
        let trackedUrl = config.url;
        let circuitChecked = false;
        let span: Awaited<ReturnType<OpenTelemetryInstrumentation['start']>>['span'] = null;

        try {
            let rc: InternalRequestConfig = this.#buildRC(config, requestId);
            trackedUrl = rc.url;
            const telemetry = await this.#otel.start(rc);
            span = telemetry.span;
            if (Object.keys(telemetry.carrier).length > 0) {
                rc = { ...rc, headers: NeutrxHeaders.from(rc.headers).concat(telemetry.carrier).toJSON() };
            }

            rc = await this.#plugins.runHook('beforeRequest', rc);
            if (rc.mockResponse) return rc.mockResponse as NeutrxResponse<TData>;

            rc = this.#security.validateRequest(rc);
            this.#rateLimiter.checkLimit(rc.url);

            if (rc.method === 'GET' && rc.cache !== false) {
                const hit = this.#cache.get(rc);
                if (hit) {
                    this.#metrics.recordCacheHit(rc.url);
                    this.emit('cache:hit', { requestId, url: rc.url });
                    this.#otel.finish(span, hit as NeutrxResponse<TData>, { retries: 0, cacheHit: true });
                    return hit as NeutrxResponse<TData>;
                }
            }

            rc = await this.#interceptors.runRequest(rc);
            this.#circuitBreaker.canRequest(rc.url);
            circuitChecked = true;

            const domain = this.#domain(rc.url);
            const { result: response, attempts } = await this.#retryEngine.execute(
                async (attempt): Promise<NeutrxResponse<TData>> => {
                    if (attempt > 0) this.#metrics.recordRetry(rc.url, attempt);
                    const raw = await this.#bulkhead.execute(domain, () => this.#dispatch(rc));
                    return this.#parse<TData>(raw, rc);
                },
                { url: rc.url }
            );

            response.attempts = attempts;
            let next: NeutrxResponse = this.#security.sanitizeResponse(response);
            next = await this.#interceptors.runResponse(next);
            next = await this.#plugins.runHook('afterRequest', next);

            if (rc.method === 'GET' && rc.cache !== false) {
                this.#cache.set(rc, next);
            }

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

            this.#otel.finish(span, next as NeutrxResponse<TData>, { retries: Math.max(0, attempts.length - 1), cacheHit: false });
            return next as NeutrxResponse<TData>;
        } catch (error: unknown) {
            const normalized = normalizeError(error) as Error & { requestId?: string; duration?: number; code?: string };
            normalized.requestId = requestId;
            normalized.duration = Date.now() - t0;
            this.#otel.fail(span, normalized);

            this.#metrics.recordError(trackedUrl, normalized);
            if (circuitChecked) this.#circuitBreaker.recordFailure(trackedUrl);

            this.emit('request:error', { requestId, url: trackedUrl, error: normalized, duration: normalized.duration });
            await this.#plugins.runHook('onError', normalized);

            const handled = await this.#interceptors.runError(normalized);
            if (handled instanceof Error) throw handled;
            return handled as NeutrxResponse<TData>;
        }
    }

    setBaseURL(url: string): this {
        this.#security.validateURL(url);
        this.#config = { ...this.#config, baseURL: url };
        return this;
    }

    setTimeout(ms: number): this {
        this.#config = { ...this.#config, timeout: ms };
        return this;
    }

    clearAuth(): this {
        this.#defaultHeaders = NeutrxHeaders.from(this.#defaultHeaders).removeAuthorization().toJSON();
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
        this.#defaultHeaders = NeutrxHeaders.from(this.#defaultHeaders).set(key, value).toJSON();
        return this;
    }

    removeHeader(key: string): this {
        const headers = NeutrxHeaders.from(this.#defaultHeaders);
        headers.delete(key);
        this.#defaultHeaders = headers.toJSON();
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
        this.#defaultHeaders = headers.toJSON();
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

    pinCertificate(host: string, fingerprint: string): this {
        this.#security.pinCertificate(host, fingerprint);
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

    getUri(config: string | RequestConfig): string {
        return buildURL(typeof config === 'string' ? { url: config } : config, this.#config);
    }

    create(config: ClientConfig = {}): NeutrxClient {
        return new NeutrxClient(mergeConfig(this.#config, config));
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
        if (typeof adapter === 'function') return adapter(config);
        if (adapter === 'fetch') return fetchAdapter(config);
        if (adapter === 'http2') return http2Adapter(config);
        if (adapter !== 'http') throw new NeutrxSecurityError(`Unknown adapter: ${String(selectedAdapter)}`, { code: 'UNKNOWN_ADAPTER' });
        return this.#http(config);
    }

    async #http(config: InternalRequestConfig): Promise<RawHttpResponse> {
        const runtimeConfig: RuntimeRequestConfig = { ...config, headers: { ...config.headers } };
        const url = new URL(runtimeConfig.url);
        const body = runtimeConfig.data === undefined ? null : await serializeBody(runtimeConfig);
        if (body !== null && !(body instanceof Readable) && !hasHeader(runtimeConfig.headers, 'Content-Length')) {
            setHeader(runtimeConfig.headers, 'Content-Length', Buffer.byteLength(body));
        }

        const proxy = resolveProxy(runtimeConfig.proxy ?? this.#config.proxy, url);
        if (runtimeConfig.socketPath && proxy) {
            throw new NeutrxSecurityError('socketPath cannot be combined with proxy', { code: 'SOCKET_PROXY_CONFLICT' });
        }
        if (proxy) await validateProxyTarget(url, runtimeConfig, this.#security);
        const requestTarget = proxy ? proxyRequestTarget(url, runtimeConfig.headers, proxy) : directRequestTarget(url, runtimeConfig.headers);
        for (const [key, value] of Object.entries(requestTarget.headers)) {
            this.#security.validateHeader(key, value);
        }
        const lookup = runtimeConfig.socketPath
            ? undefined
            : await createLookup(requestTarget.url, runtimeConfig, this.#security, this.#config.lookup, requestTarget.isProxied && !requestTarget.tunnel);

        return new Promise((resolve, reject) => {
            const isHTTPS = requestTarget.url.protocol === 'https:';
            const maxSize = runtimeConfig.maxContentLength;
            let settled = false;
            const fail = (error: Error): void => {
                if (settled) return;
                settled = true;
                reject(error);
            };

            if (runtimeConfig.socketPath && isHTTPS) {
                fail(new NeutrxSecurityError('socketPath supports HTTP only', { code: 'SOCKET_HTTPS_UNSUPPORTED' }));
                return;
            }

            const options: RequestOptions = {
                path: requestTarget.path,
                method: runtimeConfig.method,
                headers: toOutgoingHeaders(requestTarget.headers),
                ...(runtimeConfig.socketPath
                    ? { socketPath: runtimeConfig.socketPath }
                    : {
                        hostname: requestTarget.url.hostname,
                        port: requestTarget.url.port || (isHTTPS ? 443 : 80),
                        agent: requestTarget.tunnel
                            ? false
                            : isHTTPS
                            ? runtimeConfig.httpsAgent ?? this.#config.httpsAgent ?? this.#agents.https
                            : runtimeConfig.httpAgent ?? this.#config.httpAgent ?? this.#agents.http,
                    }),
                ...(lookup ? { lookup } : {}),
                ...(requestTarget.tunnel
                    ? {
                        createConnection: (_options: RequestOptions, callback: (error: Error | null, socket: Duplex) => void): Duplex | null | undefined => createHttpsProxyConnection(
                            requestTarget.tunnel!,
                            runtimeConfig.connectTimeout,
                            this.#config.security.validateCertificate,
                            callback
                        ),
                    }
                    : {}),
                ...(isHTTPS
                    ? {
                        rejectUnauthorized: this.#config.security.validateCertificate,
                        minVersion: 'TLSv1.2',
                        ciphers: SECURE_CIPHERS,
                        checkServerIdentity: (host: string, cert: PeerCertificate): Error | undefined => this.#security.checkServerIdentity(host, cert),
                    }
                    : {}),
            };

            const transport = isHTTPS ? https : http;
            const req = transport.request(options, response => {
                void this.#handleHttpResponse(response, runtimeConfig, maxSize).then(result => {
                    if (settled) return;
                    settled = true;
                    resolve(result);
                }, fail);
            });

            const connectTimer = setTimeout(() => {
                req.destroy();
                fail(new NeutrxConnectTimeoutError(runtimeConfig.url, runtimeConfig.connectTimeout));
            }, runtimeConfig.connectTimeout);

            req.on('socket', socket => {
                clearTimeout(connectTimer);
                const onTimeout = (): void => {
                    req.destroy();
                    fail(new NeutrxResponseTimeoutError(runtimeConfig.url, runtimeConfig.timeout));
                };
                socket.setTimeout(runtimeConfig.timeout);
                socket.once('timeout', onTimeout);
                req.once('close', () => {
                    socket.off('timeout', onTimeout);
                });
            });

            req.on('error', error => {
                clearTimeout(connectTimer);
                const normalized = normalizeError(error);
                fail(normalized instanceof NeutrxError ? normalized : NeutrxErrorFactory.fromNodeError(normalized, runtimeConfig));
            });

            runtimeConfig.signal?.addEventListener('abort', () => {
                req.destroy();
                fail(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
            }, { once: true });

            if (runtimeConfig.data !== undefined) {
                if (body instanceof Readable) {
                    this.#writeStreamBody(req, body, runtimeConfig, fail);
                    return;
                }

                if (body !== null) {
                    const total = Buffer.byteLength(body);
                    if (total > runtimeConfig.maxBodyLength) {
                        req.destroy();
                        fail(new NeutrxRequestSizeError(total, runtimeConfig.maxBodyLength));
                        return;
                    }
                    req.write(body, () => {
                        reportUploadProgress(runtimeConfig, total, total);
                    });
                }
            }

            req.end();
        });
    }

    async #handleHttpResponse(response: IncomingMessage, config: InternalRequestConfig, maxSize: number): Promise<RawHttpResponse> {
        if (response.statusCode && REDIRECT_CODES.has(response.statusCode) && config.followRedirects) {
            const hops = config.hops + 1;
            if (hops > config.maxRedirects) throw new Error('Max redirects exceeded');

            const location = response.headers.location;
            if (!location) throw new Error('Redirect response missing Location header');
            const redirectUrl = new URL(location, config.url).href;
            this.#security.validateURL(redirectUrl);
            this.#security.validateRedirect(config.url, redirectUrl);

            response.resume();

            const redirectedMethod = shouldRedirectWithGet(response.statusCode, config.method) ? 'GET' : config.method;
            const headers = stripRedirectHeaders(config.headers, config.url, redirectUrl, redirectedMethod !== config.method);
            const redirectedConfig = redirectedMethod === 'GET'
                ? withoutBody({ ...config, url: redirectUrl, method: redirectedMethod, headers, hops })
                : { ...config, url: redirectUrl, method: redirectedMethod, headers, hops };

            await config.beforeRedirect?.(buildRedirectContext(response.statusCode, location, config.url, redirectUrl, redirectedConfig.headers));

            return this.#http(redirectedConfig);
        }

        const rawHeaders = normalizeIncomingHeaders(response.headers);
        const status = response.statusCode ?? 0;
        const statusText = response.statusMessage ?? '';

        if (config.responseType === 'stream') {
            attachStreamDownloadProgress(response, config);
            return { status, statusText, headers: rawHeaders, data: response, config };
        }

        const chunks: Buffer[] = [];
        let received = 0;

        return new Promise((resolve, reject) => {
            const total = getContentLength(rawHeaders);
            reportDownloadProgress(config, received, total);

            response.on('data', chunk => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
                received += buffer.length;
                if (received > maxSize) {
                    response.destroy();
                    reject(new NeutrxResponseSizeError(received, maxSize));
                    return;
                }
                chunks.push(buffer);
                reportDownloadProgress(config, received, total);
            });

            response.on('end', () => {
                resolve({ status, statusText, headers: rawHeaders, data: Buffer.concat(chunks), config });
            });
            response.on('error', error => reject(normalizeError(error)));
        });
    }

    async #parse<TData extends ParsedResponseData>(raw: RawHttpResponse, config: InternalRequestConfig): Promise<NeutrxResponse<TData>> {
        let data = normalizeNodeResponseData(raw.data);
        if (Buffer.isBuffer(data) || isIncomingMessageLike(data)) data = await decompressResponseData(data, raw.headers, config.decompress);

        const parsed = parseResponseData(data, config.responseType, raw.headers, config.responseEncoding) as TData;
        const response: NeutrxResponse<TData> = {
            status: raw.status,
            statusText: raw.statusText,
            headers: raw.headers,
            data: applyResponseTransforms(parsed, raw.headers, raw.status, config.transformResponse) as TData,
            config,
            timing: { duration: Date.now() - config.startTime },
            requestId: config.requestId,
        };

        if (!config.validateStatus(raw.status)) {
            throw NeutrxErrorFactory.fromHTTPStatus(response);
        }

        return response;
    }

    #buildRC<TBody extends RequestBody>(config: RequestConfig<TBody>, requestId: string): InternalRequestConfig<TBody> {
        const method = normalizeMethod(config.method ?? 'GET');
        const headers = this.#buildHeaders(config, requestId);
        const xsrfCookieName = config.xsrfCookieName !== undefined
            ? config.xsrfCookieName
            : this.#config.xsrfCookieName !== undefined ? this.#config.xsrfCookieName : 'XSRF-TOKEN';
        const xsrfHeaderName = config.xsrfHeaderName !== undefined
            ? config.xsrfHeaderName
            : this.#config.xsrfHeaderName !== undefined ? this.#config.xsrfHeaderName : 'X-XSRF-TOKEN';
        const transformedData = applyRequestTransforms(
            config.data,
            headers,
            mergeTransformRequest(this.#config.transformRequest, config.transformRequest)
        );

        if (transformedData !== undefined && !hasHeader(headers, 'Content-Type')) {
            const contentType = detectContentType(transformedData);
            if (contentType) headers['Content-Type'] = contentType;
        }

        const requestConfig = {
            ...config,
            url: buildURL(config, this.#config),
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
            proxy: config.proxy ?? this.#config.proxy,
            httpAgent: config.httpAgent ?? this.#config.httpAgent,
            httpsAgent: config.httpsAgent ?? this.#config.httpsAgent,
            lookup: config.lookup ?? this.#config.lookup,
            socketPath: config.socketPath ?? this.#config.socketPath,
            decompress: config.decompress ?? this.#config.decompress,
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

    #buildHeaders<TBody extends RequestBody>(config: RequestConfig<TBody>, requestId: string): Headers {
        return NeutrxHeaders
            .concat(this.#defaultHeaders, this.#config.headers, config.headers, { 'X-Request-ID': requestId })
            .toJSON();
    }

    #buildDefaultHeaders(): Headers {
        return {
            'User-Agent': `neutrx/1.1.0 Node.js/${process.version}`,
            Accept: 'application/json, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate, br',
            Connection: 'keep-alive',
        };
    }

    #writeStreamBody(req: ClientRequest, body: Readable, config: InternalRequestConfig, fail: (error: Error) => void): void {
        const total = getContentLength(config.headers);
        let loaded = 0;

        if (total !== undefined && total > config.maxBodyLength) {
            req.destroy();
            fail(new NeutrxRequestSizeError(total, config.maxBodyLength));
            return;
        }

        reportUploadProgress(config, loaded, total);

        body.on('data', (chunk: unknown) => {
            body.pause();
            const buffer = toUploadBuffer(chunk);
            if (loaded + buffer.length > config.maxBodyLength) {
                req.destroy();
                fail(new NeutrxRequestSizeError(loaded + buffer.length, config.maxBodyLength));
                return;
            }
            req.write(buffer, () => {
                loaded += buffer.length;
                reportUploadProgress(config, loaded, total);
                body.resume();
            });
        });

        body.on('end', () => {
            req.end();
        });

        body.on('error', error => {
            req.destroy();
            fail(normalizeError(error));
        });
    }

    #setupAgents(): { readonly http: http.Agent; readonly https: https.Agent } {
        const options = { keepAlive: true, keepAliveMsecs: 1000, maxSockets: 50, maxFreeSockets: 10 };
        return {
            http: new http.Agent(options),
            https: new https.Agent({ ...options, minVersion: 'TLSv1.2', ciphers: SECURE_CIPHERS }),
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

function isIncomingMessageLike(data: unknown): data is IncomingMessage {
    return data !== null
        && typeof data === 'object'
        && 'pipe' in data;
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

