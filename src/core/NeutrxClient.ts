import http, { type ClientRequest, type IncomingHttpHeaders, type IncomingMessage, type RequestOptions } from 'node:http';
import https from 'node:https';
import type { PeerCertificate } from 'node:tls';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

import SecurityManager from '../security/SecurityManager.js';
import { RateLimiter } from '../security/RateLimiter.js';
import InterceptorChain from '../interceptors/InterceptorChain.js';
import CircuitBreaker from '../resilience/CircuitBreaker.js';
import { RetryEngine } from '../resilience/RetryEngine.js';
import Bulkhead from '../resilience/Bulkhead.js';
import CacheEngine from '../performance/CacheEngine.js';
import MetricsCollector from '../monitoring/MetricsCollector.js';
import type { MetricsSnapshot } from '../monitoring/MetricsCollector.js';
import { PluginManager, type NeutrxPlugin } from '../plugins/PluginManager.js';

import {
    NeutrxConnectTimeoutError,
    NeutrxErrorFactory,
    NeutrxResponseSizeError,
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
    HttpMethod,
    InternalRequestConfig,
    JsonValue,
    MockController,
    NeutrxResponse,
    NormalizedClientConfig,
    OAuth2Config,
    PaginationOptions,
    PaginationPage,
    ParsedResponseData,
    QueryValue,
    RawHttpResponse,
    RequestBody,
    RequestConfig,
    ResponseType,
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

export default class NeutrxClient extends EventEmitter {
    configureOAuth2?: (config: OAuth2Config) => void;
    gql?: <TData extends JsonValue = JsonValue>(
        endpoint: string,
        query: string,
        variables?: Record<string, JsonValue>,
        options?: { readonly operationName?: string; readonly headers?: Headers }
    ) => Promise<GraphQLResult<TData>>;
    mock?: MockController;

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
                    const raw = await this.#bulkhead.execute(domain, () => this.#http(rc));
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

    #http(config: InternalRequestConfig): Promise<RawHttpResponse> {
        return new Promise((resolve, reject) => {
            const url = new URL(config.url);
            const isHTTPS = url.protocol === 'https:';
            const maxSize = config.maxContentLength;

            const options: RequestOptions = {
                hostname: url.hostname,
                port: url.port || (isHTTPS ? 443 : 80),
                path: `${url.pathname}${url.search}`,
                method: config.method,
                headers: toOutgoingHeaders(config.headers),
                agent: isHTTPS ? this.#agents.https : this.#agents.http,
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
                void this.#handleHttpResponse(response, config, maxSize).then(result => {
                    if (settled) return;
                    settled = true;
                    resolve(result);
                }, fail);
            });

            const connectTimer = setTimeout(() => {
                req.destroy();
                fail(new NeutrxConnectTimeoutError(config.url, config.connectTimeout));
            }, config.connectTimeout);

            req.on('socket', socket => {
                clearTimeout(connectTimer);
                socket.setTimeout(config.timeout, () => {
                    req.destroy();
                    fail(new NeutrxResponseTimeoutError(config.url, config.timeout));
                });
            });

            req.on('error', error => {
                clearTimeout(connectTimer);
                fail(NeutrxErrorFactory.fromNodeError(normalizeError(error), config));
            });

            config.signal?.addEventListener('abort', () => {
                req.destroy();
                fail(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
            }, { once: true });

            if (config.data !== undefined) {
                const body = this.#serialize(config);
                if (body instanceof Readable) {
                    this.#writeStreamBody(req, body, config, fail);
                    return;
                }

                if (body !== null) {
                    const total = Buffer.byteLength(body);
                    req.write(body, () => {
                        reportUploadProgress(config, total, total);
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

            const redirectedMethod = response.statusCode === 303 ? 'GET' : config.method;
            const redirectedConfig = redirectedMethod === 'GET'
                ? withoutBody({ ...config, url: redirectUrl, method: redirectedMethod, hops })
                : { ...config, url: redirectUrl, method: redirectedMethod, hops };
            return this.#http(redirectedConfig);
        }

        const rawHeaders = normalizeIncomingHeaders(response.headers);
        const status = response.statusCode ?? 0;
        const statusText = response.statusMessage ?? '';

        if (config.responseType === 'stream') {
            return { status, statusText, headers: rawHeaders, data: response, config };
        }

        const chunks: Buffer[] = [];
        let received = 0;

        return new Promise((resolve, reject) => {
            response.on('data', chunk => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
                received += buffer.length;
                if (received > maxSize) {
                    response.destroy();
                    reject(new NeutrxResponseSizeError(received, maxSize));
                    return;
                }
                chunks.push(buffer);
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
            data: parsed,
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
        return {
            ...config,
            url: this.#buildURL(config),
            method,
            headers: this.#buildHeaders(config, requestId),
            timeout: config.timeout ?? this.#config.timeout,
            connectTimeout: config.connectTimeout ?? this.#config.connectTimeout,
            maxRedirects: config.maxRedirects ?? this.#config.maxRedirects,
            maxContentLength: config.maxContentLength ?? this.#config.maxContentLength,
            responseType: config.responseType ?? 'json',
            responseEncoding: config.responseEncoding ?? 'utf8',
            validateStatus: config.validateStatus ?? this.#config.validateStatus,
            followRedirects: config.followRedirects !== false,
            requestId,
            startTime: Date.now(),
            hops: 0,
        };
    }

    #buildURL(config: RequestConfig): string {
        let url = config.url;
        if (!/^https?:\/\//i.test(url)) {
            const base = config.baseURL ?? this.#config.baseURL ?? '';
            url = `${base.endsWith('/') ? base.slice(0, -1) : base}${url.startsWith('/') ? url : `/${url}`}`;
        }

        if (config.params && Object.keys(config.params).length > 0) {
            const parsed = new URL(url);
            for (const [key, value] of Object.entries(config.params)) {
                appendSearchParam(parsed, key, value);
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

        if (config.data !== undefined && !hasHeader(headers, 'Content-Type')) {
            headers['Content-Type'] = this.#detectContentType(config.data);
        }

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

    #detectContentType(data: RequestBody): string {
        if (typeof data === 'string') return 'text/plain';
        if (Buffer.isBuffer(data) || data instanceof Readable) return 'application/octet-stream';
        if (data instanceof URLSearchParams) return 'application/x-www-form-urlencoded';
        return 'application/json';
    }

    #serialize(config: InternalRequestConfig): string | Buffer | Readable | null {
        const data = config.data;
        if (data === undefined) return null;
        if (typeof data === 'string' || Buffer.isBuffer(data)) return data;
        if (data instanceof Readable) return data;
        if (data instanceof URLSearchParams) return data.toString();

        const contentType = headerToString(config.headers['Content-Type'] ?? config.headers['content-type']);
        if (contentType.includes('application/x-www-form-urlencoded') && isFormRecord(data)) {
            return new URLSearchParams(toFormEntries(data)).toString();
        }

        return JSON.stringify(data);
    }

    #writeStreamBody(req: ClientRequest, body: Readable, config: InternalRequestConfig, fail: (error: Error) => void): void {
        const total = getContentLength(config.headers);
        let loaded = 0;

        reportUploadProgress(config, loaded, total);

        body.on('data', (chunk: unknown) => {
            body.pause();
            const buffer = toUploadBuffer(chunk);
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
            validateStatus: custom.validateStatus ?? ((status: number): boolean => status >= 200 && status < 300),
            ...(custom.baseURL ? { baseURL: custom.baseURL } : {}),
            ...(custom.headers ? { headers: custom.headers } : {}),
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
    return 'GET';
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

function appendSearchParam(url: URL, key: string, value: QueryValue): void {
    if (value == null) return;
    if (Array.isArray(value)) {
        value.forEach(item => url.searchParams.append(key, String(item)));
        return;
    }
    url.searchParams.set(key, String(value));
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

function isFormRecord(value: RequestBody): value is Record<string, JsonValue> {
    return value !== null && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof URLSearchParams) && !(value instanceof Readable) && !Array.isArray(value);
}

function toFormEntries(data: Record<string, JsonValue>): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
        if (value == null) continue;
        entries[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return entries;
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
