import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

import { NeutrxResponseSizeError } from './NeutrxError.js';
import type { Headers, JsonValue, ParseJson, ParsedResponseData, RawHttpResponse, ResponseType } from '../types.js';
import { getHeader, headerToString } from './headers.js';

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = promisify(zlib.brotliDecompress);

export async function decompressResponseData(
    data: Buffer | IncomingMessage,
    headers: Headers,
    enabled: boolean,
    maxContentLength?: number
): Promise<Buffer | IncomingMessage> {
    if (!enabled || !Buffer.isBuffer(data)) return data;

    const encoding = headerToString(getHeader(headers, 'Content-Encoding'));
    try {
        const inflated = await inflateEncoded(data, encoding);
        if (inflated && maxContentLength !== undefined && inflated.byteLength > maxContentLength) {
            throw new NeutrxResponseSizeError(inflated.byteLength, maxContentLength);
        }
        if (inflated) return inflated;
    } catch (error: unknown) {
        if (error instanceof NeutrxResponseSizeError) throw error;
        return data;
    }
    return data;
}

async function inflateEncoded(data: Buffer, encoding: string): Promise<Buffer | null> {
    if (encoding.includes('br')) return brotliDecompress(data);
    if (encoding.includes('gzip')) return gunzip(data);
    if (encoding.includes('deflate')) return inflate(data);
    return null;
}

export function parseResponseData(
    data: RawHttpResponse['data'] | IncomingMessage,
    type: ResponseType,
    headers: Headers,
    encoding: BufferEncoding,
    parseJson: ParseJson = defaultParseJson
): ParsedResponseData {
    if (type === 'stream') return data;
    if (type === 'blob' && isBlobLike(data)) return data;
    if (type === 'formData' && isFormDataLike(data)) return data;
    if (type === 'arrayBuffer') return toArrayBufferData(data);
    if (type === 'buffer') return toBufferData(data);

    const text = toText(data, encoding);
    const contentType = headerToString(getHeader(headers, 'Content-Type'));
    if (type === 'text') return text;
    if (type === 'json' || contentType.includes('application/json')) {
        try {
            return parseJson(text);
        } catch {
            return text;
        }
    }
    return text;
}

function defaultParseJson(text: string): ParsedResponseData {
    return JSON.parse(text, safeReviver) as JsonValue;
}

export function normalizeNodeResponseData(data: RawHttpResponse['data']): Buffer | IncomingMessage | Readable | Blob | FormData | ReadableStream<Uint8Array> {
    if (Buffer.isBuffer(data)) return data;
    if (isIncomingMessageLike(data)) return data;
    if (data instanceof Readable) return data;
    if (isBlobLike(data)) return data;
    if (isFormDataLike(data)) return data;
    if (isReadableStreamLike(data)) return data;
    if (typeof data === 'string') return Buffer.from(data);
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return Buffer.from('');
}

function toBufferData(data: RawHttpResponse['data'] | IncomingMessage): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (typeof data === 'string') return Buffer.from(data);
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return Buffer.from('');
}

function toArrayBufferData(data: RawHttpResponse['data'] | IncomingMessage): ArrayBuffer {
    const buffer = toBufferData(data);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function toText(data: RawHttpResponse['data'] | IncomingMessage, encoding: BufferEncoding): string {
    if (typeof data === 'string') return data;
    if (Buffer.isBuffer(data)) return data.toString(encoding);
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString(encoding);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(encoding);
    return '';
}

function isIncomingMessageLike(data: RawHttpResponse['data'] | IncomingMessage): data is IncomingMessage {
    return data !== null
        && typeof data === 'object'
        && 'pipe' in data
        && data instanceof Readable;
}

function safeReviver(key: string, value: JsonValue): JsonValue | undefined {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return undefined;
    return value;
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

function isReadableStreamLike(value: unknown): value is ReadableStream<Uint8Array> {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly getReader?: unknown }).getReader === 'function';
}
