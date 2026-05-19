import { NeutrxResponseSizeError, NeutrxResponseTimeoutError } from '../core/NeutrxError.js';
import { NeutrxHeaders } from '../core/headers.js';
import { reportDownloadProgress, reportUploadProgress } from '../core/progress.js';
import type { FetchCredentials, Headers, RawHttpResponse, RequestAdapter, RequestBody } from '../types.js';

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

    const body = bodyless(config.method) ? undefined : toFetchBody(config.data);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new NeutrxResponseTimeoutError(config.url, config.timeout)), config.timeout);
    config.signal?.addEventListener('abort', () => controller.abort(config.signal?.reason), { once: true });

    const init: FetchInit = {
        method: config.method,
        headers: toFetchHeaders(headers.toJSON()),
        credentials: credentialsFor(config.withCredentials, config.credentials),
        signal: controller.signal,
        ...(body !== undefined ? { body } : {}),
    };

    if (body !== undefined && (isNodeReadable(body) || isReadableStreamLike(body))) init.duplex = 'half';
    reportFetchUploadProgress(config, body);

    try {
        const response = await fetchImpl(config.url, init);
        const request = createFetchRequest(config.url, init);
        return {
            status: response.status,
            statusText: response.statusText,
            headers: fromFetchHeaders(response.headers),
            data: await readResponseBody(response, config),
            config: { ...config, headers: headers.toJSON() },
            ...(request ? { request } : {}),
        } satisfies RawHttpResponse;
    } catch (error: unknown) {
        if (controller.signal.aborted && error instanceof Error && error.name === 'AbortError') {
            const reason = abortReason(controller.signal);
            if (reason instanceof Error) throw reason;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

function bodyless(method: string): boolean {
    return method === 'GET' || method === 'HEAD';
}

function abortReason(signal: AbortSignal): unknown {
    return (signal as AbortSignalWithReason).reason;
}

function toFetchBody(data: RequestBody | undefined): FetchBody | undefined {
    if (data === undefined) return undefined;
    if (typeof data === 'string') return data;
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) return data;
    if (data instanceof URLSearchParams) return data;
    if (isBlobLike(data)) return data;
    if (isFormDataLike(data)) return data;
    if (isReadableStreamLike(data) || isNodeReadable(data)) return data as FetchBody;
    return JSON.stringify(data) as FetchBody;
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
            return response.body;
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

function reportFetchUploadProgress(config: Parameters<RequestAdapter>[0], body: FetchBody | undefined): void {
    if (!config.onUploadProgress || body === undefined || isNodeReadable(body) || isReadableStreamLike(body)) return;
    const bytes = fetchBodyLength(body);
    if (bytes !== undefined) reportUploadProgress(config, bytes, bytes);
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
    if (token) headers.set(headerName, token);
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
