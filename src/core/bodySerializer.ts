import { Readable } from 'node:stream';

import { NeutrxSecurityError } from './NeutrxError.js';
import { getHeader, hasHeader, headerToString, setHeader, type NeutrxHeaders } from './headers.js';
import type { FormSerializerOptions, Headers, RequestBody, StringifyJson } from '../types.js';

export type SerializedBody = string | Buffer | Readable | null;
type RuntimeBodyConfig = {
    readonly data?: RequestBody;
    readonly headers: Headers | NeutrxHeaders;
    readonly formSerializer?: FormSerializerOptions;
    readonly stringifyJson?: StringifyJson;
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
    if (isFormDataLike(data)) return serializeMultipart(data, config.headers);

    const contentType = headerToString(getHeader(config.headers, 'Content-Type'));
    if (contentType.includes('multipart/form-data') && isFormRecord(data)) {
        return serializeMultipart(toFormData(data, config.formSerializer), config.headers);
    }
    if (contentType.includes('application/x-www-form-urlencoded') && isFormRecord(data)) {
        return new URLSearchParams(toFormEntries(data, config.formSerializer)).toString();
    }
    if (!hasHeader(config.headers, 'Content-Type')) setHeader(config.headers, 'Content-Type', 'application/json');
    return (config.stringifyJson ?? JSON.stringify)(assertSerializable(data));
}

export function toFormData(data: Record<string, unknown>, options: FormSerializerOptions = {}): FormData {
    if (typeof FormData === 'undefined') {
        throw new NeutrxSecurityError('FormData is unavailable in this runtime', { code: 'FORMDATA_UNAVAILABLE' });
    }
    const form = new FormData();
    appendFormValue(form, '', data, options, new WeakSet<object>(), 0);
    return form;
}

function toFormEntries(data: Record<string, unknown>, options: FormSerializerOptions = {}): Array<[string, string]> {
    const params: Array<[string, string]> = [];
    flattenFormEntries(params, '', data, options, new WeakSet<object>(), 0);
    return params;
}

function appendFormValue(
    form: FormData,
    path: string,
    value: unknown,
    options: FormSerializerOptions,
    seen: WeakSet<object>,
    depth: number
): void {
    assertDepth(depth, options.maxDepth);
    if (value == null) return;
    if (isBlobLike(value)) {
        form.append(path, value);
        return;
    }
    if (isFileListLike(value)) {
        Array.from(value).forEach((file, index) => form.append(arrayKey(path, index, options), file));
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => appendFormValue(form, arrayKey(path, index, options), item, options, seen, depth + 1));
        return;
    }
    if (typeof value === 'object') {
        assertNotCircular(value, seen);
        for (const [key, child] of Object.entries(value)) {
            appendFormValue(form, joinKey(path, key, options), child, options, seen, depth + 1);
        }
        seen.delete(value);
        return;
    }
    form.append(path, scalarToString(value));
}

function flattenFormEntries(
    result: Array<[string, string]>,
    path: string,
    value: unknown,
    options: FormSerializerOptions,
    seen: WeakSet<object>,
    depth: number
): void {
    assertDepth(depth, options.maxDepth);
    if (value == null) return;
    if (isBlobLike(value) || isFileListLike(value)) {
        result.push([path, '[binary]']);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => flattenFormEntries(result, arrayKey(path, index, options), item, options, seen, depth + 1));
        return;
    }
    if (typeof value === 'object') {
        assertNotCircular(value, seen);
        for (const [key, child] of Object.entries(value)) {
            flattenFormEntries(result, joinKey(path, key, options), child, options, seen, depth + 1);
        }
        seen.delete(value);
        return;
    }
    result.push([path, scalarToString(value)]);
}

async function serializeMultipart(data: FormData, headers: Headers | NeutrxHeaders): Promise<Buffer> {
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

        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${escapeMultipart(name)}"\r\n\r\n${String(value)}\r\n`));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(chunks);
}

function multipartBoundary(headers: Headers | NeutrxHeaders): string {
    const currentContentType = getHeader(headers, 'Content-Type');
    const contentType = headerToString(currentContentType);
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (match?.[1] || match?.[2]) return match[1] ?? match[2] ?? '';

    const boundary = `----neutrx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    if (currentContentType !== false) setHeader(headers, 'Content-Type', `multipart/form-data; boundary=${boundary}`);
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

function assertNotCircular(value: object, seen: WeakSet<object>): void {
    if (seen.has(value)) throw new NeutrxSecurityError('Circular body reference detected', { code: 'BODY_CIRCULAR_REFERENCE' });
    seen.add(value);
}

function assertDepth(depth: number, maxDepth = 20): void {
    if (depth > maxDepth) throw new NeutrxSecurityError('Form body depth limit exceeded', { code: 'FORM_DEPTH_EXCEEDED' });
}

function joinKey(parent: string, key: string, options: FormSerializerOptions): string {
    if (!parent) return key;
    return options.dots ? `${parent}.${key}` : `${parent}[${key}]`;
}

function arrayKey(parent: string, index: number, options: FormSerializerOptions): string {
    if (options.indexes === true) return `${parent}[${index}]`;
    if (options.indexes === null) return parent;
    return `${parent}[]`;
}

function isFormRecord(value: RequestBody): value is Record<string, unknown> {
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

export function isBlobLike(value: unknown): value is Blob {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly arrayBuffer?: unknown }).arrayBuffer === 'function'
        && typeof (value as { readonly size?: unknown }).size === 'number'
        && typeof (value as { readonly type?: unknown }).type === 'string';
}

export function isFormDataLike(value: unknown): value is FormData {
    return typeof FormData !== 'undefined' && value instanceof FormData;
}

function isFileListLike(value: unknown): value is Iterable<Blob> & { readonly length: number } {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly length?: unknown }).length === 'number'
        && typeof (value as { readonly item?: unknown }).item === 'function'
        && typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

function scalarToString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (typeof value === 'symbol') return value.description ?? '';
    if (typeof value === 'function') return value.name || '[function]';
    return JSON.stringify(value) ?? '';
}
