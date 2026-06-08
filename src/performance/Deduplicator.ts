import type { HeaderValue, HttpMethod, InternalRequestConfig, PerformanceConfig, RawHttpResponse } from '../types.js';

export const DEFAULT_DEDUPLICATE_METHODS: readonly HttpMethod[] = ['GET', 'HEAD'];
export const DEFAULT_DEDUPLICATE_HEADERS: readonly string[] = ['accept', 'authorization', 'range'];

export interface DeduplicationHit {
    readonly key: string;
    readonly requestId: string;
    readonly url: string;
    readonly method: HttpMethod;
}

export interface DeduplicationDispatchOptions {
    readonly adapterKey: string;
    readonly canUseDefaultKey: boolean;
    readonly onHit?: (hit: DeduplicationHit) => void;
}

export default class Deduplicator {
    #inflight = new Map<string, Promise<RawHttpResponse>>();
    #enabled: boolean;
    #methods: ReadonlySet<HttpMethod>;
    #headers: readonly string[];
    #key?: PerformanceConfig['deduplicateRequestKey'];

    constructor(config: PerformanceConfig = {}) {
        this.#enabled = config.deduplicateRequests ?? true;
        this.#methods = new Set(config.deduplicateMethods ?? DEFAULT_DEDUPLICATE_METHODS);
        this.#headers = normalizeHeaderNames(config.deduplicateHeaders ?? DEFAULT_DEDUPLICATE_HEADERS);
        this.#key = config.deduplicateRequestKey;
    }

    async dispatch(
        config: InternalRequestConfig,
        execute: () => Promise<RawHttpResponse>,
        options: DeduplicationDispatchOptions
    ): Promise<RawHttpResponse> {
        const key = this.key(config, options);
        if (key === null) return execute();

        const existing = this.#inflight.get(key);
        if (existing) {
            options.onHit?.({ key, requestId: config.requestId, url: config.url, method: config.method });
            const raw = await existing;
            return { ...raw, config, data: cloneRawData(raw.data), deduplicated: true };
        }

        const pending = execute();
        this.#inflight.set(key, pending);
        try {
            const raw = await pending;
            return { ...raw, data: cloneRawData(raw.data) };
        } finally {
            this.#inflight.delete(key);
        }
    }

    key(config: InternalRequestConfig, options: Pick<DeduplicationDispatchOptions, 'adapterKey' | 'canUseDefaultKey'>): string | null {
        if (
            !this.#enabled
            || !this.#methods.has(config.method)
            || config.cache === false
            || config.responseType === 'stream'
            || config.signal !== undefined
            || config.cancelToken !== undefined
        ) return null;

        if (this.#key) {
            const customKey = this.#key(config);
            return customKey === undefined || customKey === null || customKey === '' ? null : String(customKey);
        }

        if (!options.canUseDefaultKey || hasCustomTransport(config)) return null;

        return JSON.stringify({
            method: config.method,
            socketPath: config.socketPath ?? '',
            url: config.url,
            responseType: config.responseType,
            timeout: config.timeout,
            connectTimeout: config.connectTimeout,
            maxRedirects: config.maxRedirects,
            maxContentLength: config.maxContentLength,
            maxBodyLength: config.maxBodyLength,
            followRedirects: config.followRedirects,
            httpVersion: config.httpVersion ?? '',
            http2Options: config.http2Options ?? {},
            proxy: config.proxy === false ? 'disabled' : '',
            headers: selectedHeaders(config, this.#headers),
            adapter: options.adapterKey,
        });
    }

    clear(): void {
        this.#inflight.clear();
    }
}

function selectedHeaders(config: InternalRequestConfig, names: readonly string[]): Record<string, string> {
    const selected: Record<string, string> = {};
    for (const name of names) {
        const value = getHeader(config.headers, name);
        if (value !== undefined && value !== false) selected[name] = headerToString(value);
    }
    return selected;
}

function getHeader(headers: InternalRequestConfig['headers'], name: string): HeaderValue | undefined {
    if (typeof headers.get === 'function') return headers.get(name);
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lowerName) return value;
    }
    return undefined;
}

function headerToString(value: HeaderValue): string {
    if (Array.isArray(value)) return value.map(item => String(item)).join(', ');
    return String(value);
}

function normalizeHeaderNames(names: readonly string[]): readonly string[] {
    return [...new Set(names.map(name => name.toLowerCase()))].sort();
}

function hasCustomTransport(config: InternalRequestConfig): boolean {
    return Boolean(
        config.beforeRedirect
        || config.fetch
        || config.httpAgent
        || config.httpsAgent
        || config.lookup
        || (config.proxy !== undefined && config.proxy !== false)
        || config.tls
        || config.maxRate !== undefined
    );
}

function cloneRawData(data: RawHttpResponse['data']): RawHttpResponse['data'] {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return Buffer.from(data);
    if (data instanceof ArrayBuffer) return data.slice(0);
    if (data instanceof Uint8Array) return data.slice();
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.slice();
    return data;
}
