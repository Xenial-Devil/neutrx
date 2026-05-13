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

    if (body !== undefined && isNodeReadable(body)) {
        init.duplex = 'half';
    }

    const response = await globalThis.fetch(config.url, init);
    const bytes = Buffer.from(await response.arrayBuffer());

    reportDownloadProgress(config, bytes.length, bytes.length);

    return {
        status: response.status,
        statusText: response.statusText,
        headers: fromFetchHeaders(response.headers),
        data: bytes,
        config,
    } satisfies RawHttpResponse;
};

function bodyless(method: string): boolean {
    return method === 'GET' || method === 'HEAD';
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
    if (isNodeReadable(data)) return data as unknown as FetchBody;
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

function reportDownloadProgress(config: Parameters<RequestAdapter>[0], loaded: number, total: number): void {
    config.onDownloadProgress?.({ loaded, total, percent: 100 });
}

function isNodeReadable(value: unknown): boolean {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly pipe?: unknown }).pipe === 'function'
        && typeof (value as { readonly on?: unknown }).on === 'function';
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
