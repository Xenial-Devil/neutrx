import { NeutrxResponseSizeError, NeutrxResponseTimeoutError, axiosTimeoutErrorCode } from '../core/NeutrxError.js';
import { NeutrxHeaders, getContentLength } from '../core/headers.js';
import type { FetchCredentials, Headers, InternalHeaders, InternalRequestConfig, ProgressEvent, RawHttpResponse, RequestAdapter, RequestBody } from '../types.js';

type FetchInit = RequestInit & { duplex?: 'half' };
type FetchBody = NonNullable<RequestInit['body']>;
type BrowserGlobal = typeof globalThis & {
    readonly location?: { readonly href: string; readonly origin: string };
    readonly document?: { readonly cookie: string };
    readonly window?: unknown;
};
type AbortSignalWithReason = AbortSignal & { readonly reason?: unknown };
type StreamRead = { readonly done: boolean; readonly value?: Uint8Array };
type ProgressDirection = 'upload' | 'download';
type ProgressState = { readonly loaded: number; readonly timestamp: number };

const uploadProgressState = new WeakMap<InternalRequestConfig, ProgressState>();
const downloadProgressState = new WeakMap<InternalRequestConfig, ProgressState>();

export const fetchAdapter: RequestAdapter = async config => {
    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('Fetch adapter requires globalThis.fetch');
    }

    const requestHeaders = NeutrxHeaders.from(config.headers);
    injectXsrfHeader(requestHeaders, config);
    const headers = toFetchHeaders(requestHeaders);

    const body = trackFetchUploadProgress(
        config,
        bodyless(config.method) ? undefined : toFetchBody(config.data, config.stringifyJson)
    );
    const abort = composeAbort(config);
    const init: FetchInit = {
        method: config.method,
        headers,
        credentials: credentialsFor(config.withCredentials, config.credentials),
        signal: abort.signal,
        ...(body !== undefined ? { body } : {}),
    };

    if (body !== undefined && isStreamLike(body)) init.duplex = 'half';

    try {
        const response = await fetchImpl(config.url, init);
        const request = createRequest(config.url, init);
        return {
            status: response.status,
            statusText: response.statusText,
            headers: fromFetchHeaders(response.headers),
            data: await readResponseBody(response, config),
            config: { ...config, headers: requestHeaders as unknown as InternalHeaders },
            ...(request ? { request } : {}),
        } satisfies RawHttpResponse;
    } catch (error: unknown) {
        if (abort.timedOut()) {
            throw new NeutrxResponseTimeoutError(config.url, config.timeout, {
                code: axiosTimeoutErrorCode(config.transitional),
            });
        }
        if (abort.signal.aborted) {
            const reason = abortReason(abort.signal);
            if (reason instanceof Error) throw reason;
            throw Object.assign(new Error('Request aborted'), { name: 'AbortError' });
        }
        throw error;
    } finally {
        abort.dispose();
    }
};

function bodyless(method: string): boolean {
    return method === 'GET' || method === 'HEAD';
}

function composeAbort(config: InternalRequestConfig): {
    readonly signal: AbortSignal;
    readonly dispose: () => void;
    readonly timedOut: () => boolean;
} {
    const controller = new AbortController();
    let timeoutHit = false;

    const abort = (reason: unknown): void => {
        if (!controller.signal.aborted) controller.abort(reason);
    };
    const onAbort = (): void => abort(config.signal ? abortReason(config.signal) : undefined);

    if (config.signal?.aborted) {
        abort(abortReason(config.signal));
    } else {
        config.signal?.addEventListener('abort', onAbort, { once: true });
    }

    const timer = setTimeout(() => {
        timeoutHit = true;
        abort(new NeutrxResponseTimeoutError(config.url, config.timeout, {
            code: axiosTimeoutErrorCode(config.transitional),
        }));
    }, Math.max(0, config.timeout));

    return {
        signal: controller.signal,
        dispose: () => {
            clearTimeout(timer);
            config.signal?.removeEventListener('abort', onAbort);
        },
        timedOut: () => timeoutHit,
    };
}

function abortReason(signal: AbortSignal): unknown {
    return (signal as AbortSignalWithReason).reason;
}

function toFetchBody(data: RequestBody | undefined, stringifyJson = JSON.stringify): FetchBody | undefined {
    if (data === undefined) return undefined;
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) return data;
    if (data instanceof URLSearchParams) return data;
    if (isBlobLike(data)) return data;
    if (isFormDataLike(data)) return data;
    if (isStreamLike(data)) return data as FetchBody;
    return stringifyJson(data) as FetchBody;
}

function toFetchHeaders(headers: Headers | NeutrxHeaders): globalThis.Headers {
    const next = new globalThis.Headers();
    for (const [key, value] of Object.entries(NeutrxHeaders.from(headers).toJSON())) {
        if (key.toLowerCase() === 'content-length') continue;
        next.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }
    return next;
}

function fromFetchHeaders(headers: globalThis.Headers): Headers {
    const next: Headers = {};
    headers.forEach((value, key) => {
        next[key] = value;
    });
    return next;
}

async function readResponseBody(response: Response, config: InternalRequestConfig): Promise<RawHttpResponse['data']> {
    switch (config.responseType) {
        case 'stream':
            return trackFetchDownloadStream(response.body, config, contentLength(response.headers));
        case 'blob':
            return typeof response.blob === 'function' ? response.blob() : readArrayBuffer(response, config);
        case 'formData':
            return typeof response.formData === 'function' ? response.formData() : readArrayBuffer(response, config);
        case 'arrayBuffer':
        case 'buffer':
            return readArrayBuffer(response, config);
        case 'json':
        case 'text':
        default:
            return decodeText(await readArrayBuffer(response, config), config.responseEncoding);
    }
}

async function readArrayBuffer(response: Response, config: InternalRequestConfig): Promise<ArrayBuffer> {
    const total = contentLength(response.headers);
    if (!response.body || !config.onDownloadProgress) {
        reportDownloadProgress(config, 0, total);
        const data = await response.arrayBuffer();
        assertContentLength(data.byteLength, config.maxContentLength);
        reportDownloadProgress(config, data.byteLength, total ?? data.byteLength);
        return data;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    reportDownloadProgress(config, loaded, total);

    let done = false;
    while (!done) {
        const read = await reader.read() as StreamRead;
        done = read.done;
        const value = read.value;
        if (!value) continue;
        loaded += value.byteLength;
        assertContentLength(loaded, config.maxContentLength);
        chunks.push(value);
        reportDownloadProgress(config, loaded, total);
    }

    return toArrayBuffer(concatChunks(chunks, loaded));
}

function assertContentLength(size: number, limit: number): void {
    if (size > limit) throw new NeutrxResponseSizeError(size, limit);
}

function trackFetchUploadProgress(config: InternalRequestConfig, body: FetchBody | undefined): FetchBody | undefined {
    if (!config.onUploadProgress || body === undefined) return body;

    const knownBytes = fetchBodyLength(body);
    if (knownBytes !== undefined) {
        reportKnownUploadProgress(config, knownBytes);
        return body;
    }

    if (isStreamLike(body)) return trackReadableStreamUploadProgress(body, config, getContentLength(config.headers));
    return body;
}

function fetchBodyLength(body: FetchBody): number | undefined {
    if (typeof body === 'string') return byteLength(body);
    if (body instanceof ArrayBuffer) return body.byteLength;
    if (ArrayBuffer.isView(body)) return body.byteLength;
    if (body instanceof URLSearchParams) return byteLength(body.toString());
    if (isBlobLike(body)) return body.size;
    return undefined;
}

function reportKnownUploadProgress(config: InternalRequestConfig, total: number): void {
    reportUploadProgress(config, 0, total);
    reportUploadProgress(config, total, total);
}

function trackReadableStreamUploadProgress(
    stream: ReadableStream<Uint8Array>,
    config: InternalRequestConfig,
    total?: number
): ReadableStream<Uint8Array> {
    if (typeof TransformStream === 'undefined') return stream;

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

function injectXsrfHeader(headers: NeutrxHeaders, config: InternalRequestConfig): void {
    if (!isStandardBrowserEnvironment()) return;
    if (!config.xsrfCookieName || !config.xsrfHeaderName) return;

    const shouldInject = typeof config.withXSRFToken === 'function'
        ? config.withXSRFToken(config)
        : config.withXSRFToken === true || (config.withXSRFToken !== false && isSameOrigin(config.url));
    if (!shouldInject) return;

    const token = readCookie(config.xsrfCookieName);
    if (token) headers.setIfNotBlocked(config.xsrfHeaderName, token);
}

function credentialsFor(withCredentials: boolean | undefined, credentials: FetchCredentials | undefined): FetchCredentials {
    if (credentials) return credentials;
    if (withCredentials === true) return 'include';
    if (withCredentials === false) return 'omit';
    return 'same-origin';
}

function createRequest(url: string, init: FetchInit): Request | undefined {
    if (typeof Request === 'undefined') return undefined;
    if (init.body !== undefined && isStreamLike(init.body)) return undefined;
    try {
        return new Request(url, init);
    } catch {
        return undefined;
    }
}

function contentLength(headers: globalThis.Headers): number | undefined {
    const value = headers.get('content-length');
    if (!value) return undefined;
    const length = Number.parseInt(value, 10);
    return Number.isFinite(length) && length >= 0 ? length : undefined;
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
    const event: ProgressEvent = {
        loaded,
        bytes,
        rate,
        ...(direction === 'upload' ? { upload: true as const } : { download: true as const }),
        ...(total !== undefined ? { total } : {}),
        ...(total !== undefined && total > 0 ? { percent: Math.min(100, Number(((loaded / total) * 100).toFixed(2))) } : {}),
        ...(total !== undefined && total > 0 ? { progress: Math.min(1, Number((loaded / total).toFixed(4))) } : {}),
        ...(total !== undefined && rate > 0 ? { estimated: Number(((Math.max(0, total - loaded)) / rate).toFixed(3)) } : {}),
    };
    stateMap.set(config, { loaded, timestamp: now });
    callback(event);
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
