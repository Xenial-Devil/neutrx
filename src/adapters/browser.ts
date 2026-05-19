import type { Headers, RawHttpResponse, RequestAdapter, RequestBody } from '../types.js';

type FetchInit = RequestInit & { duplex?: 'half' };
type FetchBody = NonNullable<RequestInit['body']>;

export const fetchAdapter: RequestAdapter = async config => {
    if (typeof globalThis.fetch !== 'function') {
        throw new Error('Fetch adapter requires globalThis.fetch');
    }

    const body = bodyless(config.method) ? undefined : toFetchBody(config.data);
    const init: FetchInit = {
        method: config.method,
        headers: toFetchHeaders(config.headers),
        ...(body !== undefined ? { body } : {}),
        ...(config.signal ? { signal: config.signal } : {}),
    };

    if (body !== undefined && isStreamLike(body)) init.duplex = 'half';

    const response = await globalThis.fetch(config.url, init);
    const data = await response.arrayBuffer();
    config.onDownloadProgress?.({
        loaded: data.byteLength,
        total: data.byteLength,
        percent: 100,
        bytes: data.byteLength,
        rate: 0,
        estimated: 0,
        download: true,
    });

    return {
        status: response.status,
        statusText: response.statusText,
        headers: fromFetchHeaders(response.headers),
        data,
        config,
        ...requestReference(config.url, init),
    } satisfies RawHttpResponse;
};

function bodyless(method: string): boolean {
    return method === 'GET' || method === 'HEAD';
}

function toFetchBody(data: RequestBody | undefined): FetchBody | undefined {
    if (data === undefined) return undefined;
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) return data;
    if (data instanceof URLSearchParams) return data;
    if (isBlobLike(data)) return data;
    if (isFormDataLike(data)) return data;
    if (isStreamLike(data)) return data as FetchBody;
    return JSON.stringify(data) as FetchBody;
}

function toFetchHeaders(headers: Headers): globalThis.Headers {
    const next = new globalThis.Headers();
    for (const [key, value] of Object.entries(headers)) {
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

function requestReference(url: string, init: FetchInit): { readonly request?: Request } {
    if (typeof Request === 'undefined') return {};
    if (init.body !== undefined && isStreamLike(init.body)) return {};
    try {
        return { request: new Request(url, init) };
    } catch {
        return {};
    }
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
