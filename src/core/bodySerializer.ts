import { Readable } from 'node:stream';

import { assertDepth, assertNotCircular, buildFormData, isBlobLike, isFileListLike, toFormEntries } from './formData.js';
import { getHeader, hasHeader, headerToString, setHeader, type NeutrxHeaders } from './headers.js';
import type { EnvConfig, FormDataHeaderPolicy, FormSerializerOptions, Headers, RequestBody, StringifyJson } from '../types.js';

export { buildFormData as toFormData, isBlobLike } from './formData.js';

export type SerializedBody = string | Buffer | Readable | null;
type RuntimeBodyConfig = {
    readonly data?: RequestBody;
    readonly headers: Headers | NeutrxHeaders;
    readonly formSerializer?: FormSerializerOptions;
    readonly stringifyJson?: StringifyJson;
    readonly formDataHeaderPolicy?: FormDataHeaderPolicy;
    readonly env?: EnvConfig;
};

export function detectContentType(data: RequestBody): string | undefined {
    if (typeof data === 'string') return 'text/plain';
    if (isFormDataLike(data)) return undefined;
    if (isBlobLike(data)) return data.type || 'application/octet-stream';
    if (Buffer.isBuffer(data) || data instanceof Readable || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return 'application/octet-stream';
    if (data instanceof URLSearchParams) return 'application/x-www-form-urlencoded';
    return 'application/json';
}

export async function serializeBody(config: RuntimeBodyConfig): Promise<SerializedBody> {
    const data = config.data;
    if (data === undefined) return null;
    if (typeof data === 'string' || Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof Readable) return data;
    if (data instanceof URLSearchParams) {
        if (!hasHeader(config.headers, 'Content-Type')) setHeader(config.headers, 'Content-Type', 'application/x-www-form-urlencoded;charset=utf-8');
        return data.toString();
    }
    if (isBlobLike(data)) return Buffer.from(await data.arrayBuffer());
    const envFormData = config.env?.FormData;
    if (isFormDataLike(data, envFormData)) return serializeMultipart(data, config.headers, config.formDataHeaderPolicy);

    const contentType = headerToString(getHeader(config.headers, 'Content-Type'));
    if (contentType.includes('multipart/form-data') && isFormRecord(data, envFormData)) {
        return serializeMultipart(buildFormData(data, config.formSerializer, envFormData), config.headers, config.formDataHeaderPolicy);
    }
    if (contentType.includes('application/x-www-form-urlencoded') && isFormRecord(data)) {
        return new URLSearchParams(toFormEntries(data, config.formSerializer)).toString();
    }
    if (!hasHeader(config.headers, 'Content-Type')) setHeader(config.headers, 'Content-Type', 'application/json');
    return (config.stringifyJson ?? JSON.stringify)(assertSerializable(data));
}

async function serializeMultipart(data: FormData, headers: Headers | NeutrxHeaders, policy: FormDataHeaderPolicy = 'auto'): Promise<Buffer> {
    const boundary = multipartBoundary(headers, policy);
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

        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${escapeMultipart(name)}"\r\n\r\n${String(value)}\r\n`));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(chunks);
}

function multipartBoundary(headers: Headers | NeutrxHeaders, policy: FormDataHeaderPolicy = 'auto'): string {
    const currentContentType = getHeader(headers, 'Content-Type');
    const contentType = headerToString(currentContentType);
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (match?.[1] || match?.[2]) return match[1] ?? match[2] ?? '';

    const boundary = `----neutrx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    // `auto` sets Content-Type unless the header is blocked (false); `preserve` only
    // sets it when no Content-Type exists yet (never overwrites); `none` never touches it.
    const shouldSet = policy === 'none'
        ? false
        : policy === 'preserve'
        ? currentContentType === undefined
        : currentContentType !== false;
    if (shouldSet) setHeader(headers, 'Content-Type', `multipart/form-data; boundary=${boundary}`);
    return boundary;
}

function multipartFilename(value: Blob): string {
    const maybeFile = value as Blob & { readonly name?: string };
    return maybeFile.name ?? 'blob';
}

function escapeMultipart(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '%22').replace(/[\r\n]/g, ' ');
}

function assertSerializable(value: RequestBody): RequestBody {
    if (value !== null && typeof value === 'object' && !isKnownBody(value)) {
        assertNoCircular(value, new WeakSet<object>(), 0);
    }
    return value;
}

function assertNoCircular(value: object, seen: WeakSet<object>, depth: number): void {
    assertDepth(depth, 100);
    assertNotCircular(value, seen);
    for (const child of Object.values(value as Record<string, unknown>)) {
        if (child !== null && typeof child === 'object' && !isKnownBody(child)) assertNoCircular(child, seen, depth + 1);
    }
    seen.delete(value);
}

function isFormRecord(value: RequestBody, envFormData?: typeof FormData): value is Record<string, unknown> {
    return value !== null
        && typeof value === 'object'
        && !Buffer.isBuffer(value)
        && !(value instanceof URLSearchParams)
        && !(value instanceof Readable)
        && !(value instanceof ArrayBuffer)
        && !ArrayBuffer.isView(value)
        && !isBlobLike(value)
        && !isFormDataLike(value, envFormData)
        && !Array.isArray(value);
}

function isKnownBody(value: object): boolean {
    return Buffer.isBuffer(value)
        || value instanceof URLSearchParams
        || value instanceof Readable
        || value instanceof ArrayBuffer
        || ArrayBuffer.isView(value)
        || isBlobLike(value)
        || isFormDataLike(value)
        || isFileListLike(value);
}

export function isFormDataLike(value: unknown, envFormData?: typeof FormData): value is FormData {
    if (envFormData && value instanceof envFormData) return true;
    return typeof FormData !== 'undefined' && value instanceof FormData;
}
