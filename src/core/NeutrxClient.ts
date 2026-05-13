import http, { type ClientRequest, type IncomingHttpHeaders, type IncomingMessage, type RequestOptions } from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';
import type { PeerCertificate } from 'node:tls';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
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

import {
    NeutrxConnectTimeoutError,
    NeutrxError,
    NeutrxErrorFactory,
    NeutrxRequestSizeError,
    NeutrxResponseSizeError,
    NeutrxSecurityError,
    NeutrxResponseTimeoutError,
} from './NeutrxError.js';
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
    HeaderValue,
    HttpMethod,
    InternalRequestConfig,
    JsonValue,
    LookupFunction,
    MockController,
    NeutrxResponse,
    NormalizedClientConfig,
    OAuth2Config,
    PaginationOptions,
    PaginationPage,
    ParsedResponseData,
    ProxyConfig,
    QueryValue,
    QueryParams,
    RawHttpResponse,
    RequestBody,
    RequestConfig,
    ResponseType,
    TransformRequest,
    TransformResponse,
    SseHandle,
} from '../types.js';

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = promisify(zlib.brotliDecompress);

const SECURE_CIPHERS = [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256',
].join(':');

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

type BodylessRequestConfig = Omit<RequestConfig, 'url' | 'method' | 'data'>;
type BodyRequestConfig<TBody extends RequestBody> = Omit<RequestConfig<TBody>, 'url' | 'method' | 'data'>;
type ResolvedAddress = { readonly address: string; readonly family: number };
type RuntimeRequestConfig = InternalRequestConfig & { headers: Headers };
type SerializedBody = string | Buffer | Readable | null;
type NormalizedProxyConfig = Required<Pick<ProxyConfig, 'protocol' | 'host'>> & Pick<ProxyConfig, 'port' | 'auth' | 'headers'>;

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
    #defaultHeaders: Headers;
    #agents: { http: http.Agent; https: https.Agent };

    constructor(config: ClientConfig = {}) {
        super();
        this.#config = this.#buildConfig(config);
        this.#security = new SecurityManager(this.#config.security);
        this.#interceptors = new InterceptorChain();
        this.#circuitBreaker = new CircuitBreaker(this.#config.resilience);
        this.#retryEngine = new RetryEngine(this.#config.resilience);
        this.#bulkhead = new Bulkhead(this.#config.resilience);
        this.#cache = new CacheEngine(this.#config.performance);
        this.#metrics = new MetricsCollector();
        this.#rateLimiter = new RateLimiter(this.#config.security.rateLimit ?? {});
        this.#plugins = new PluginManager(this);
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

        try {
            let rc: InternalRequestConfig = this.#buildRC(config, requestId);
            trackedUrl = rc.url;

            rc = await this.#plugins.runHook('beforeRequest', rc);
            if (rc.mockResponse) return rc.mockResponse as NeutrxResponse<TData>;

            rc = this.#security.validateRequest(rc);
            this.#rateLimiter.checkLimit(rc.url);

            if (rc.method === 'GET' && rc.cache !== false) {
                const hit = this.#cache.get(rc);
                if (hit) {
                    this.#metrics.recordCacheHit(rc.url);
                    this.emit('cache:hit', { requestId, url: rc.url });
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
        this.#security.validateHeader(key, value);
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
            this.#defaultHeaders.Authorization = `Basic ${Buffer.from(`${auth.basic.username}:${auth.basic.password}`).toString('base64')}`;
        } else if (auth.apiKey) {
            this.#defaultHeaders[auth.apiKey.header ?? 'X-Api-Key'] = auth.apiKey.key;
        }
        return this;
    }

    useRequest(onFulfilled?: Parameters<InterceptorChain['addRequest']>[0], onRejected?: Parameters<InterceptorChain['addRequest']>[1]): number {
        return this.#interceptors.addRequest(onFulfilled, onRejected);
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

    create(config: ClientConfig = {}): NeutrxClient {
        return new NeutrxClient(mergeConfig(this.#config, config));
    }

    destroy(): void {
        this.#agents.http.destroy();
        this.#agents.https.destroy();
        this.#cache.destroy();
        this.#metrics.destroy();
        this.removeAllListeners();
    }

    async #dispatch(config: InternalRequestConfig): Promise<RawHttpResponse> {
        const adapter = config.adapter ?? this.#config.adapter;
        if (adapter) return adapter(config);
        return this.#http(config);
    }

    async #http(config: InternalRequestConfig): Promise<RawHttpResponse> {
        const runtimeConfig: RuntimeRequestConfig = { ...config, headers: { ...config.headers } };
        const url = new URL(runtimeConfig.url);
        const body = runtimeConfig.data === undefined ? null : await this.#serialize(runtimeConfig);
        if (body !== null && !(body instanceof Readable) && !hasHeader(runtimeConfig.headers, 'Content-Length')) {
            setHeader(runtimeConfig.headers, 'Content-Length', Buffer.byteLength(body));
        }

        const proxy = resolveProxy(runtimeConfig.proxy ?? this.#config.proxy);
        if (proxy) await this.#validateProxyTarget(url, runtimeConfig);
        const requestTarget = proxy ? proxyRequestTarget(url, runtimeConfig.headers, proxy) : directRequestTarget(url, runtimeConfig.headers);
        for (const [key, value] of Object.entries(requestTarget.headers)) {
            this.#security.validateHeader(key, value);
        }
        const lookup = await this.#createLookup(requestTarget.url, runtimeConfig, requestTarget.isProxied);

        return new Promise((resolve, reject) => {
            const isHTTPS = requestTarget.url.protocol === 'https:';
            const maxSize = runtimeConfig.maxContentLength;

            const options: RequestOptions = {
                hostname: requestTarget.url.hostname,
                port: requestTarget.url.port || (isHTTPS ? 443 : 80),
                path: requestTarget.path,
                method: runtimeConfig.method,
                headers: toOutgoingHeaders(requestTarget.headers),
                agent: isHTTPS
                    ? runtimeConfig.httpsAgent ?? this.#config.httpsAgent ?? this.#agents.https
                    : runtimeConfig.httpAgent ?? this.#config.httpAgent ?? this.#agents.http,
                ...(lookup ? { lookup } : {}),
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
            let settled = false;
            const fail = (error: Error): void => {
                if (settled) return;
                settled = true;
                reject(error);
            };

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
                socket.setTimeout(runtimeConfig.timeout, () => {
                    req.destroy();
                    fail(new NeutrxResponseTimeoutError(runtimeConfig.url, runtimeConfig.timeout));
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

    async #validateProxyTarget(url: URL, config: InternalRequestConfig): Promise<void> {
        if (net.isIP(url.hostname)) return;
        const records = await dnsLookup(url.hostname, { all: true, verbatim: true });
        for (const record of records) {
            this.#security.validateResolvedAddress(config.url, record.address);
        }
    }

    async #createLookup(url: URL, config: InternalRequestConfig, isProxy = false): Promise<LookupFunction | undefined> {
        const customLookup = config.lookup ?? this.#config.lookup;
        if (customLookup) return wrapLookup(customLookup, this.#security, config.url, isProxy);

        if (net.isIP(url.hostname)) return undefined;

        const records = await dnsLookup(url.hostname, { all: true, verbatim: true });
        if (!isProxy) {
            for (const record of records) {
                this.#security.validateResolvedAddress(config.url, record.address);
            }
        }

        return createPinnedLookup(records);
    }

    async #handleHttpResponse(response: IncomingMessage, config: InternalRequestConfig, maxSize: number): Promise<RawHttpResponse> {
        if (response.statusCode && REDIRECT_CODES.has(response.statusCode) && config.followRedirects) {
            const hops = config.hops + 1;
            if (hops > config.maxRedirects) throw new Error('Max redirects exceeded');

            const location = response.headers.location;
            if (!location) throw new Error('Redirect response missing Location header');
            const redirectUrl = new URL(location, config.url).href;
            this.#security.validateURL(redirectUrl);

            response.resume();

            const redirectedMethod = shouldRedirectWithGet(response.statusCode, config.method) ? 'GET' : config.method;
            const headers = stripRedirectHeaders(config.headers, config.url, redirectUrl, redirectedMethod !== config.method);
            const redirectedConfig = redirectedMethod === 'GET'
                ? withoutBody({ ...config, url: redirectUrl, method: redirectedMethod, headers, hops })
                : { ...config, url: redirectUrl, method: redirectedMethod, headers, hops };

            await config.beforeRedirect?.({
                statusCode: response.statusCode,
                location,
                fromURL: config.url,
                toURL: redirectUrl,
                headers: redirectedConfig.headers,
            });

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
        let data: Buffer | IncomingMessage = raw.data;

        if (Buffer.isBuffer(data)) {
            const encoding = headerToString(raw.headers['content-encoding']);
            try {
                if (encoding.includes('br')) data = await brotliDecompress(data);
                else if (encoding.includes('gzip')) data = await gunzip(data);
                else if (encoding.includes('deflate')) data = await inflate(data);
            } catch {
                // Keep raw body if server declares bad compression.
            }
        }

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
        const transformedData = applyRequestTransforms(
            config.data,
            headers,
            mergeTransformRequest(this.#config.transformRequest, config.transformRequest)
        );

        if (transformedData !== undefined && !hasHeader(headers, 'Content-Type')) {
            const contentType = this.#detectContentType(transformedData);
            if (contentType) headers['Content-Type'] = contentType;
        }

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
            transformRequest: mergeTransformRequest(this.#config.transformRequest, config.transformRequest),
            transformResponse: mergeTransformResponse(this.#config.transformResponse, config.transformResponse),
            adapter: config.adapter ?? this.#config.adapter,
            proxy: config.proxy ?? this.#config.proxy,
            httpAgent: config.httpAgent ?? this.#config.httpAgent,
            httpsAgent: config.httpsAgent ?? this.#config.httpsAgent,
            lookup: config.lookup ?? this.#config.lookup,
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
            if (serialized) {
                parsed.search = serialized.startsWith('?') ? serialized.slice(1) : serialized;
            }
            url = parsed.toString();
        }

        return url;
    }

    #buildHeaders<TBody extends RequestBody>(config: RequestConfig<TBody>, requestId: string): Headers {
        const headers: Headers = {
            ...this.#defaultHeaders,
            ...(this.#config.headers ?? {}),
            ...(config.headers ?? {}),
            'X-Request-ID': requestId,
        };

        return headers;
    }

    #buildDefaultHeaders(): Headers {
        return {
            'User-Agent': `neutrx/1.0.0 Node.js/${process.version}`,
            Accept: 'application/json, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate, br',
            Connection: 'keep-alive',
        };
    }

    #detectContentType(data: RequestBody): string | undefined {
        if (typeof data === 'string') return 'text/plain';
        if (isFormDataLike(data)) return undefined;
        if (isBlobLike(data)) return data.type || 'application/octet-stream';
        if (Buffer.isBuffer(data) || data instanceof Readable || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return 'application/octet-stream';
        if (data instanceof URLSearchParams) return 'application/x-www-form-urlencoded';
        return 'application/json';
    }

    async #serialize(config: RuntimeRequestConfig): Promise<SerializedBody> {
        const data = config.data;
        if (data === undefined) return null;
        if (typeof data === 'string' || Buffer.isBuffer(data)) return data;
        if (data instanceof ArrayBuffer) return Buffer.from(data);
        if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        if (data instanceof Readable) return data;
        if (data instanceof URLSearchParams) return data.toString();
        if (isBlobLike(data)) return Buffer.from(await data.arrayBuffer());
        if (isFormDataLike(data)) return serializeMultipart(data, config.headers);

        const contentType = headerToString(config.headers['Content-Type'] ?? config.headers['content-type']);
        if (contentType.includes('application/x-www-form-urlencoded') && isFormRecord(data)) {
            return new URLSearchParams(toFormEntries(data)).toString();
        }

        return JSON.stringify(data);
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

    #buildConfig(custom: ClientConfig): NormalizedClientConfig {
        return {
            timeout: custom.timeout ?? 30_000,
            connectTimeout: custom.connectTimeout ?? 10_000,
            maxRedirects: custom.maxRedirects ?? 5,
            maxContentLength: custom.maxContentLength ?? 52_428_800,
            maxBodyLength: custom.maxBodyLength ?? Number.POSITIVE_INFINITY,
            validateStatus: custom.validateStatus ?? ((status: number): boolean => status >= 200 && status < 300),
            ...(custom.baseURL ? { baseURL: custom.baseURL } : {}),
            ...(custom.headers ? { headers: custom.headers } : {}),
            ...(custom.paramsSerializer ? { paramsSerializer: custom.paramsSerializer } : {}),
            ...(custom.transformRequest ? { transformRequest: normalizeArray(custom.transformRequest) } : {}),
            ...(custom.transformResponse ? { transformResponse: normalizeArray(custom.transformResponse) } : {}),
            ...(custom.adapter ? { adapter: custom.adapter } : {}),
            ...(custom.proxy !== undefined ? { proxy: custom.proxy } : {}),
            ...(custom.httpAgent ? { httpAgent: custom.httpAgent } : {}),
            ...(custom.httpsAgent ? { httpsAgent: custom.httpsAgent } : {}),
            ...(custom.lookup ? { lookup: custom.lookup } : {}),
            security: {
                enforceHTTPS: custom.security?.enforceHTTPS ?? true,
                validateCertificate: custom.security?.validateCertificate ?? true,
                enableSSRFProtection: custom.security?.enableSSRFProtection ?? true,
                blockPrivateIPs: custom.security?.blockPrivateIPs ?? true,
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
                retryableStatuses: custom.resilience?.retryableStatuses ?? [408, 429, 500, 502, 503, 504],
                retryableCodes: custom.resilience?.retryableCodes ?? ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH'],
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
    for (const [key, value] of Object.entries(params)) {
        appendSearchParam(encoded, key, value, serializer?.encode);
    }
    return encoded.toString();
}

function parseResponseData(data: Buffer | IncomingMessage, type: ResponseType, headers: Headers, encoding: BufferEncoding): ParsedResponseData {
    if (type === 'stream') return data;
    if (type === 'buffer') return Buffer.isBuffer(data) ? data : Buffer.from('');

    const text = Buffer.isBuffer(data) ? data.toString(encoding) : '';
    const contentType = headerToString(headers['content-type']);
    if (type === 'text') return text;
    if (type === 'json' || contentType.includes('application/json')) {
        try {
            return JSON.parse(text, safeReviver) as JsonValue;
        } catch {
            return text;
        }
    }
    return text;
}

function safeReviver(key: string, value: JsonValue): JsonValue | undefined {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return undefined;
    return value;
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

function toOutgoingHeaders(headers: Headers): RequestOptions['headers'] {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]));
}

function normalizeIncomingHeaders(headers: IncomingHttpHeaders): Headers {
    const result: Headers = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        result[key] = value;
    }
    return result;
}

function headerToString(value: Headers[string] | undefined): string {
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

function hasHeader(headers: Headers, key: string): boolean {
    const lower = key.toLowerCase();
    return Object.keys(headers).some(header => header.toLowerCase() === lower);
}

function setHeader(headers: Headers, key: string, value: HeaderValue): void {
    const existing = Object.keys(headers).find(header => header.toLowerCase() === key.toLowerCase());
    headers[existing ?? key] = value;
}

function getContentLength(headers: Headers): number | undefined {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-length');
    const value = entry ? headerToString(entry[1]) : '';
    const length = Number.parseInt(value, 10);
    return Number.isFinite(length) && length >= 0 ? length : undefined;
}

function toUploadBuffer(chunk: unknown): Buffer {
    if (Buffer.isBuffer(chunk)) return chunk;
    if (typeof chunk === 'string') return Buffer.from(chunk);
    if (chunk instanceof Uint8Array) return Buffer.from(chunk);
    return Buffer.from(String(chunk));
}

function reportUploadProgress(config: InternalRequestConfig, loaded: number, total?: number): void {
    if (!config.onUploadProgress) return;

    if (total !== undefined && total > 0) {
        config.onUploadProgress({
            loaded,
            total,
            percent: Math.min(100, Number(((loaded / total) * 100).toFixed(2))),
        });
        return;
    }

    config.onUploadProgress({ loaded });
}

function reportDownloadProgress(config: InternalRequestConfig, loaded: number, total?: number): void {
    if (!config.onDownloadProgress) return;

    if (total !== undefined && total > 0) {
        config.onDownloadProgress({
            loaded,
            total,
            percent: Math.min(100, Number(((loaded / total) * 100).toFixed(2))),
        });
        return;
    }

    config.onDownloadProgress({ loaded });
}

function attachStreamDownloadProgress(response: IncomingMessage, config: InternalRequestConfig): void {
    if (!config.onDownloadProgress) return;

    const total = getContentLength(normalizeIncomingHeaders(response.headers));
    let loaded = 0;
    reportDownloadProgress(config, loaded, total);
    response.on('data', chunk => {
        loaded += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
        reportDownloadProgress(config, loaded, total);
    });
}

function shouldRedirectWithGet(statusCode: number, method: HttpMethod): boolean {
    if (statusCode === 303 && method !== 'HEAD') return true;
    return (statusCode === 301 || statusCode === 302) && method === 'POST';
}

function stripRedirectHeaders(headers: Headers, fromURL: string, toURL: string, bodyDropped: boolean): Headers {
    const from = new URL(fromURL);
    const to = new URL(toURL);
    const crossOrigin = from.origin !== to.origin;
    const protocolDowngrade = from.protocol === 'https:' && to.protocol === 'http:';
    const stripped = new Set(['authorization', 'cookie', 'proxy-authorization']);

    if (crossOrigin) stripped.add('host');
    if (bodyDropped) {
        stripped.add('content-type');
        stripped.add('content-length');
        stripped.add('transfer-encoding');
    }

    const next: Headers = {};
    for (const [key, value] of Object.entries(headers)) {
        const normalized = key.toLowerCase();
        if ((crossOrigin || protocolDowngrade) && stripped.has(normalized)) continue;
        if (bodyDropped && stripped.has(normalized)) continue;
        next[key] = value;
    }
    return next;
}

function resolveProxy(proxy: ProxyConfig | false | undefined): NormalizedProxyConfig | undefined {
    if (!proxy) return undefined;
    const rawProtocol: unknown = proxy.protocol ?? 'http';
    if (rawProtocol !== 'http' && rawProtocol !== 'https') {
        throw new NeutrxSecurityError(`Unsupported proxy protocol: ${String(rawProtocol)}`, { code: 'UNSUPPORTED_PROXY_PROTOCOL' });
    }
    const protocol = rawProtocol;
    return {
        protocol,
        host: proxy.host,
        ...(proxy.port !== undefined ? { port: proxy.port } : {}),
        ...(proxy.auth !== undefined ? { auth: proxy.auth } : {}),
        ...(proxy.headers ? { headers: proxy.headers } : {}),
    };
}

function directRequestTarget(targetURL: URL, headers: Headers): { readonly url: URL; readonly path: string; readonly headers: Headers; readonly isProxied: false } {
    return {
        url: targetURL,
        path: `${targetURL.pathname}${targetURL.search}`,
        headers,
        isProxied: false,
    };
}

function proxyRequestTarget(
    targetURL: URL,
    requestHeaders: Headers,
    proxy: NormalizedProxyConfig
): { readonly url: URL; readonly path: string; readonly headers: Headers; readonly isProxied: true } {
    if (targetURL.protocol === 'https:') {
        throw new NeutrxSecurityError('HTTPS proxy CONNECT is not built in; pass a tunneling httpsAgent for HTTPS proxying', { code: 'HTTPS_PROXY_AGENT_REQUIRED' });
    }

    const proxyURL = new URL(`${proxy.protocol}://${proxy.host}`);
    if (proxy.port !== undefined) proxyURL.port = String(proxy.port);

    const headers: Headers = { ...(proxy.headers ?? {}) };
    if (proxy.auth !== undefined) {
        headers['Proxy-Authorization'] = proxyAuthHeader(proxy.auth);
    }
    if (!hasHeader(requestHeaders, 'Host')) {
        headers.Host = targetURL.host;
    }

    return {
        url: proxyURL,
        path: targetURL.href,
        headers: mergeProxyHeaders(requestHeaders, headers),
        isProxied: true,
    };
}

function mergeProxyHeaders(headers: Headers, proxyHeaders: Headers): Headers {
    return { ...headers, ...proxyHeaders };
}

function proxyAuthHeader(auth: NonNullable<ProxyConfig['auth']>): string {
    if (typeof auth === 'string') return auth;
    return `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
}

function createPinnedLookup(records: readonly ResolvedAddress[]): LookupFunction {
    const pinned = [...records];

    const lookup: LookupFunction = (hostname: string, options: unknown, callback?: unknown): void => {
        const done = (typeof options === 'function' ? options : callback) as LookupCallback | undefined;
        if (!done) return;

        const lookupOptions = typeof options === 'function' ? undefined : options;
        const family = typeof lookupOptions === 'number'
            ? lookupOptions
            : isLookupOptions(lookupOptions) && typeof lookupOptions.family === 'number'
                ? lookupOptions.family
                : undefined;
        const all = isLookupOptions(lookupOptions) && lookupOptions.all === true;
        const matches = family ? pinned.filter(record => record.family === family) : pinned;

        if (matches.length === 0) {
            const error = Object.assign(new Error(`DNS resolution failed: ${hostname}`), { code: 'ENOTFOUND' });
            done(error);
            return;
        }

        if (all) {
            done(null, matches.map(record => ({ address: record.address, family: record.family })));
            return;
        }

        const selected = matches[0];
        if (!selected) return;
        done(null, selected.address, selected.family);
    };

    return lookup;
}

function wrapLookup(lookup: LookupFunction, security: SecurityManager, url: string, isProxy = false): LookupFunction {
    const wrapped: LookupFunction = (hostname: string, options: unknown, callback?: unknown): void => {
        const done = (typeof options === 'function' ? options : callback) as LookupCallback | undefined;
        if (!done) return;

        const wrappedDone: LookupCallback = (error, address, family) => {
            if (error) {
                done(error);
                return;
            }

            try {
                if (Array.isArray(address) && !isProxy) {
                    address.forEach(item => security.validateResolvedAddress(url, item.address));
                } else if (typeof address === 'string' && !isProxy) {
                    security.validateResolvedAddress(url, address);
                }
            } catch (validationError: unknown) {
                done(normalizeError(validationError));
                return;
            }

            done(null, address, family);
        };

        if (typeof options === 'function') {
            (lookup as unknown as (lookupHostname: string, lookupCallback: LookupCallback) => void)(hostname, wrappedDone);
            return;
        }

        lookup(hostname, options as Parameters<LookupFunction>[1], wrappedDone);
    };

    return wrapped;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address?: string | ResolvedAddress[], family?: number) => void;

function isLookupOptions(value: unknown): value is { readonly family?: number; readonly all?: boolean } {
    return value !== null && typeof value === 'object';
}

function isFormRecord(value: RequestBody): value is Record<string, JsonValue> {
    return value !== null
        && typeof value === 'object'
        && !Buffer.isBuffer(value)
        && !(value instanceof URLSearchParams)
        && !(value instanceof Readable)
        && !(value instanceof ArrayBuffer)
        && !ArrayBuffer.isView(value)
        && !isBlobLike(value)
        && !isFormDataLike(value)
        && !Array.isArray(value);
}

function toFormEntries(data: Record<string, JsonValue>): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
        if (value == null) continue;
        entries[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return entries;
}

async function serializeMultipart(data: FormData, headers: Headers): Promise<Buffer> {
    const boundary = multipartBoundary(headers);
    const chunks: Buffer[] = [];

    for (const [name, value] of data.entries()) {
        chunks.push(Buffer.from(`--${boundary}\r\n`));
        if (isBlobLike(value)) {
            const filename = multipartFilename(value);
            const contentType = value.type || 'application/octet-stream';
            chunks.push(Buffer.from(
                `Content-Disposition: form-data; name="${escapeMultipart(name)}"; filename="${escapeMultipart(filename)}"\r\n`
                + `Content-Type: ${contentType}\r\n\r\n`
            ));
            chunks.push(Buffer.from(await value.arrayBuffer()));
            chunks.push(Buffer.from('\r\n'));
            continue;
        }

        chunks.push(Buffer.from(
            `Content-Disposition: form-data; name="${escapeMultipart(name)}"\r\n\r\n${String(value)}\r\n`
        ));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(chunks);
}

function multipartBoundary(headers: Headers): string {
    const contentType = headerToString(headers['Content-Type'] ?? headers['content-type']);
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (match?.[1] || match?.[2]) return match[1] ?? match[2] ?? '';

    const boundary = `----neutrx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    setHeader(headers, 'Content-Type', `multipart/form-data; boundary=${boundary}`);
    return boundary;
}

function multipartFilename(value: Blob): string {
    const maybeFile = value as Blob & { readonly name?: string };
    return maybeFile.name ?? 'blob';
}

function escapeMultipart(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '%22').replace(/[\r\n]/g, ' ');
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

function mergeConfig(base: NormalizedClientConfig, override: ClientConfig): ClientConfig {
    return {
        ...base,
        ...override,
        security: { ...base.security, ...(override.security ?? {}) },
        resilience: { ...base.resilience, ...(override.resilience ?? {}) },
        performance: { ...base.performance, ...(override.performance ?? {}) },
    };
}

function withoutBody(config: InternalRequestConfig): InternalRequestConfig {
    const entries = Object.entries(config).filter(([key]) => key !== 'data');
    return Object.fromEntries(entries) as InternalRequestConfig;
}
