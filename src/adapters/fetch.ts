import { NeutrxResponseSizeError, NeutrxResponseTimeoutError, axiosTimeoutErrorCode } from '../core/NeutrxError.js';
import { NeutrxHeaders, getContentLength } from '../core/headers.js';
import { reportDownloadProgress, reportUploadProgress, toUploadBuffer } from '../core/progress.js';
import type { FetchCredentials, Headers, InternalHeaders, RawHttpResponse, RequestAdapter, RequestBody } from '../types.js';

type FetchInit = RequestInit & { duplex?: 'half' };
type FetchBody = NonNullable<RequestInit['body']>;
type BrowserGlobal = typeof globalThis & {
    readonly location?: { readonly href: string; readonly origin: string };
    readonly document?: { readonly cookie: string };
    readonly window?: unknown;
};
type StreamRead = { readonly done: boolean; readonly value?: Uint8Array };
type AbortSignalWithReason = AbortSignal & { readonly reason?: unknown };

export const fetchAdapter: RequestAdapter = async config => {
    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('Fetch adapter requires fetch');
    }

    const headers = NeutrxHeaders.from(config.headers);
    injectXsrfHeader(headers, config);

    const body = trackFetchUploadProgress(
        config,
        bodyless(config.method) ? undefined : toFetchBody(config.data, config.stringifyJson)
    );
    const timeoutSignal = AbortSignal.timeout(config.timeout);
    const signal = combineAbortSignals(config.signal, timeoutSignal);

    const init: FetchInit = {
        method: config.method,
        headers: toFetchHeaders(headers.toJSON()),
        credentials: credentialsFor(config.withCredentials, config.credentials),
        redirect: 'manual',
        signal,
        ...(body !== undefined ? { body } : {}),
    };

    if (body !== undefined && (isNodeReadable(body) || isReadableStreamLike(body))) init.duplex = 'half';

    try {
        const response = await fetchImpl(config.url, init);
        const request = createFetchRequest(config.url, init);
        return {
            status: response.status,
            statusText: response.statusText,
            headers: fromFetchHeaders(response.headers),
            data: await readResponseBody(response, config),
            config: { ...config, headers: headers as unknown as InternalHeaders },
            ...(request ? { request } : {}),
        } satisfies RawHttpResponse;
    } catch (error: unknown) {
        if (signal.aborted) {
            const reason = timeoutSignal.aborted
                ? new NeutrxResponseTimeoutError(config.url, config.timeout, {
                    code: axiosTimeoutErrorCode(config.transitional),
                })
                : abortReason(signal);
            if (reason instanceof Error) throw reason;
        }
        throw error;
    }
};

function bodyless(method: string): boolean {
    return method === 'GET' || method === 'HEAD';
}

function abortReason(signal: AbortSignal): unknown {
    return (signal as AbortSignalWithReason).reason;
}

function combineAbortSignals(signal: AbortSignal | undefined, timeoutSignal: AbortSignal): AbortSignal {
    if (!signal) return timeoutSignal;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeoutSignal]);

    const controller = new AbortController();
    const abortFrom = (source: AbortSignal): void => {
        const reason = abortReason(source);
        if (reason === undefined) controller.abort();
        else controller.abort(reason);
    };

    if (signal.aborted) {
        abortFrom(signal);
        return controller.signal;
    }
    if (timeoutSignal.aborted) {
        abortFrom(timeoutSignal);
        return controller.signal;
    }

    const abortFromCaller = () => abortFrom(signal);
    const abortFromTimeout = () => abortFrom(timeoutSignal);
    signal.addEventListener('abort', abortFromCaller, { once: true });
    timeoutSignal.addEventListener('abort', abortFromTimeout, { once: true });
    controller.signal.addEventListener('abort', () => {
        signal.removeEventListener('abort', abortFromCaller);
        timeoutSignal.removeEventListener('abort', abortFromTimeout);
    }, { once: true });

    return controller.signal;
}

function toFetchBody(data: RequestBody | undefined, stringifyJson = JSON.stringify): FetchBody | undefined {
    if (data === undefined) return undefined;
    if (typeof data === 'string') return data;
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) return data;
    if (data instanceof URLSearchParams) return data;
    if (isBlobLike(data)) return data;
    if (isFormDataLike(data)) return data;
    if (isReadableStreamLike(data) || isNodeReadable(data)) return data as FetchBody;
    return stringifyJson(data) as FetchBody;
}

function toFetchHeaders(headers: Headers): globalThis.Headers {
    const next = new globalThis.Headers();
    for (const [key, value] of Object.entries(headers)) {
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

async function readResponseBody(response: Response, config: Parameters<RequestAdapter>[0]): Promise<RawHttpResponse['data']> {
    switch (config.responseType) {
        case 'stream':
            return trackFetchDownloadStream(response.body, config, contentLength(response.headers));
        case 'blob':
            return typeof response.blob === 'function' ? response.blob() : Buffer.from(await response.arrayBuffer());
        case 'formData':
            return typeof response.formData === 'function' ? response.formData() : Buffer.from(await response.arrayBuffer());
        case 'arrayBuffer':
            return readArrayBuffer(response, config);
        case 'buffer':
        case 'json':
        case 'text':
            return Buffer.from(await readArrayBuffer(response, config));
        default:
            return Buffer.from(await readArrayBuffer(response, config));
    }
}

async function readArrayBuffer(response: Response, config: Parameters<RequestAdapter>[0]): Promise<ArrayBuffer> {
    const total = contentLength(response.headers);
    if (!response.body || !config.onDownloadProgress) {
        reportDownloadProgress(config, 0, total);
        const data = await response.arrayBuffer();
        if (data.byteLength > config.maxContentLength) throw new NeutrxResponseSizeError(data.byteLength, config.maxContentLength);
        reportDownloadProgress(config, data.byteLength, total ?? data.byteLength);
        return data;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    reportDownloadProgress(config, loaded, total);

    let reading = true;
    while (reading) {
        const read = await reader.read() as StreamRead;
        reading = !read.done;
        const value = read.value;
        if (read.done) break;
        if (!value) continue;
        loaded += value.byteLength;
        if (loaded > config.maxContentLength) throw new NeutrxResponseSizeError(loaded, config.maxContentLength);
        chunks.push(value);
        reportDownloadProgress(config, loaded, total);
    }

    return toArrayBuffer(concatChunks(chunks, loaded));
}

function trackFetchUploadProgress(config: Parameters<RequestAdapter>[0], body: FetchBody | undefined): FetchBody | undefined {
    if (!config.onUploadProgress || body === undefined) return body;

    const knownBytes = fetchBodyLength(body);
    if (knownBytes !== undefined) {
        reportKnownUploadProgress(config, knownBytes);
        return body;
    }

    const total = getContentLength(config.headers);
    if (isReadableStreamLike(body)) return trackReadableStreamUploadProgress(body, config, total);
    if (isNodeReadable(body) && isAsyncIterable(body) && typeof ReadableStream !== 'undefined') {
        return trackAsyncIterableUploadProgress(body, config, total) as FetchBody;
    }

    return body;
}

function fetchBodyLength(body: FetchBody): number | undefined {
    if (typeof body === 'string') return Buffer.byteLength(body);
    if (Buffer.isBuffer(body)) return body.length;
    if (body instanceof ArrayBuffer) return body.byteLength;
    if (ArrayBuffer.isView(body)) return body.byteLength;
    if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
    if (isBlobLike(body)) return body.size;
    return undefined;
}

function reportKnownUploadProgress(config: Parameters<RequestAdapter>[0], total: number): void {
    reportUploadProgress(config, 0, total);
    reportUploadProgress(config, total, total);
}

function trackReadableStreamUploadProgress(
    stream: ReadableStream<Uint8Array>,
    config: Parameters<RequestAdapter>[0],
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

function trackAsyncIterableUploadProgress(
    stream: AsyncIterable<unknown>,
    config: Parameters<RequestAdapter>[0],
    total?: number
): ReadableStream<Uint8Array> {
    const iterator = stream[Symbol.asyncIterator]();
    let loaded = 0;
    reportUploadProgress(config, loaded, total);

    return new ReadableStream<Uint8Array>({
        async pull(controller): Promise<void> {
            try {
                const read = await iterator.next();
                if (read.done) {
                    controller.close();
                    return;
                }
                const chunk = toUploadBuffer(read.value);
                loaded += chunk.byteLength;
                reportUploadProgress(config, loaded, total);
                controller.enqueue(chunk);
            } catch (error) {
                controller.error(error);
            }
        },
        async cancel(): Promise<void> {
            await iterator.return?.();
            const destroy = (stream as { readonly destroy?: () => void }).destroy;
            if (typeof destroy === 'function') destroy.call(stream);
        },
    });
}

function trackFetchDownloadStream(
    stream: ReadableStream<Uint8Array> | null,
    config: Parameters<RequestAdapter>[0],
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

function createFetchRequest(url: string, init: FetchInit): Request | undefined {
    if (typeof Request === 'undefined') return undefined;
    if (init.body !== undefined && (isNodeReadable(init.body) || isReadableStreamLike(init.body))) return undefined;
    try {
        return new Request(url, init);
    } catch {
        return undefined;
    }
}

function injectXsrfHeader(headers: NeutrxHeaders, config: Parameters<RequestAdapter>[0]): void {
    if (!isStandardBrowserEnvironment()) return;
    const cookieName = config.xsrfCookieName;
    const headerName = config.xsrfHeaderName;
    if (!cookieName || !headerName) return;

    const shouldInject = typeof config.withXSRFToken === 'function'
        ? config.withXSRFToken(config)
        : config.withXSRFToken === true || (config.withXSRFToken !== false && isSameOrigin(config.url));
    if (!shouldInject) return;

    const token = readCookie(cookieName);
    if (token) headers.setIfNotBlocked(headerName, token);
}

function credentialsFor(withCredentials: boolean | undefined, credentials: FetchCredentials | undefined): FetchCredentials {
    if (credentials) return credentials;
    if (withCredentials === true) return 'include';
    if (withCredentials === false) return 'omit';
    return 'same-origin';
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

function contentLength(headers: globalThis.Headers): number | undefined {
    const value = headers.get('content-length');
    if (!value) return undefined;
    const length = Number.parseInt(value, 10);
    return Number.isFinite(length) && length >= 0 ? length : undefined;
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

function isNodeReadable(value: unknown): boolean {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly pipe?: unknown }).pipe === 'function'
        && typeof (value as { readonly on?: unknown }).on === 'function';
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function';
}

function isReadableStreamLike(value: unknown): value is ReadableStream<Uint8Array> {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly getReader?: unknown }).getReader === 'function';
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
