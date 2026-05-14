import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

import { NeutrxInjectionError, NeutrxSecurityError } from './NeutrxError.js';
import type { Headers, HeaderValue } from '../types.js';

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization']);

type HeaderEntry = {
    readonly name: string;
    readonly value: HeaderValue;
};

type HeaderSource = Headers | NeutrxHeaders | Iterable<readonly [string, HeaderValue | string]> | {
    readonly forEach?: (callback: (value: string, key: string) => void) => void;
};

export class NeutrxHeaders {
    #headers = new Map<string, HeaderEntry>();

    constructor(init?: HeaderSource) {
        if (init !== undefined) this.setAll(init);
    }

    static from(init?: HeaderSource): NeutrxHeaders {
        return init instanceof NeutrxHeaders ? new NeutrxHeaders(init.toJSON()) : new NeutrxHeaders(init);
    }

    static concat(...sources: readonly (HeaderSource | undefined)[]): NeutrxHeaders {
        const result = new NeutrxHeaders();
        for (const source of sources) {
            if (source !== undefined) result.setAll(source);
        }
        return result.normalize();
    }

    set(name: string, value: HeaderValue): this {
        validateHeaderName(name);
        validateHeaderValue(name, value);

        const key = normalizeHeaderKey(name);
        const existing = this.#headers.get(key);
        if (key === 'set-cookie' && existing) {
            this.#headers.set(key, {
                name: existing.name,
                value: [...toHeaderArray(existing.value), ...toHeaderArray(value)],
            });
            return this;
        }

        this.#headers.set(key, { name: existing?.name ?? name, value });
        return this;
    }

    setAll(source: HeaderSource): this {
        if (source instanceof NeutrxHeaders) {
            for (const [name, value] of Object.entries(source.toJSON())) this.set(name, value);
            return this;
        }

        if (isHeadersLike(source)) {
            source.forEach((value, key) => this.set(key, value));
            return this;
        }

        if (isIterableHeaderSource(source)) {
            for (const [name, value] of source as Iterable<readonly [string, HeaderValue]>) this.set(name, value);
            return this;
        }

        const headerRecord = source as Headers;
        for (const name of Object.keys(headerRecord)) {
            const value = headerRecord[name];
            if (value !== undefined) this.set(name, value);
        }
        return this;
    }

    get(name: string): HeaderValue | undefined {
        validateHeaderName(name);
        return this.#headers.get(normalizeHeaderKey(name))?.value;
    }

    has(name: string): boolean {
        validateHeaderName(name);
        return this.#headers.has(normalizeHeaderKey(name));
    }

    delete(name: string): boolean {
        validateHeaderName(name);
        return this.#headers.delete(normalizeHeaderKey(name));
    }

    clear(): this {
        this.#headers.clear();
        return this;
    }

    normalize(): this {
        const normalized = new Map<string, HeaderEntry>();
        for (const entry of this.#headers.values()) {
            const key = normalizeHeaderKey(entry.name);
            const existing = normalized.get(key);
            if (key === 'set-cookie' && existing) {
                normalized.set(key, {
                    name: existing.name,
                    value: [...toHeaderArray(existing.value), ...toHeaderArray(entry.value)],
                });
                continue;
            }
            normalized.set(key, entry);
        }
        this.#headers = normalized;
        return this;
    }

    concat(...sources: readonly (HeaderSource | undefined)[]): NeutrxHeaders {
        return NeutrxHeaders.concat(this, ...sources);
    }

    toJSON(): Headers {
        const result: Headers = {};
        for (const { name, value } of this.#headers.values()) result[name] = value;
        return result;
    }

    getSetCookie(): string[] {
        const value = this.#headers.get('set-cookie')?.value;
        if (value === undefined) return [];
        return toHeaderArray(value);
    }

    setContentType(value: string): this {
        return this.set('Content-Type', value);
    }

    getContentType(): string | undefined {
        const value = this.get('Content-Type');
        return value === undefined ? undefined : headerToString(value);
    }

    setAccept(value: string): this {
        return this.set('Accept', value);
    }

    setAuthorization(value: string): this {
        return this.set('Authorization', value);
    }

    setBearerAuth(token: string): this {
        return this.setAuthorization(`Bearer ${token}`);
    }

    removeAuthorization(): this {
        this.delete('Authorization');
        return this;
    }

    redactSensitive(redaction = '[REDACTED]'): Headers {
        const result: Headers = {};
        for (const { name, value } of this.#headers.values()) {
            result[name] = SENSITIVE_HEADERS.has(normalizeHeaderKey(name))
                ? Array.isArray(value) ? value.map(() => redaction) : redaction
                : value;
        }
        return result;
    }
}

export function validateHeaderName(name: string): void {
    if (!name || !HEADER_NAME_RE.test(name)) {
        throw new NeutrxInjectionError('Header name', name);
    }
}

export function validateHeaderValue(name: string, value: HeaderValue): void {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
        const rendered = String(item);
        if (/[\r\n]/.test(rendered)) {
            throw new NeutrxInjectionError('CRLF header injection', name);
        }
    }
}

export function hasHeader(headers: Headers, key: string): boolean {
    return NeutrxHeaders.from(headers).has(key);
}

export function getHeader(headers: Headers, key: string): HeaderValue | undefined {
    return NeutrxHeaders.from(headers).get(key);
}

export function setHeader(headers: Headers, key: string, value: HeaderValue): void {
    const next = NeutrxHeaders.from(headers).set(key, value).toJSON();
    for (const existing of Object.keys(headers)) delete headers[existing];
    Object.assign(headers, next);
}

export function deleteHeader(headers: Headers, key: string): void {
    const next = NeutrxHeaders.from(headers);
    next.delete(key);
    for (const existing of Object.keys(headers)) delete headers[existing];
    Object.assign(headers, next.toJSON());
}

export function headerToString(value: Headers[string] | undefined): string {
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

export function normalizeIncomingHeaders(headers: IncomingHttpHeaders): Headers {
    const result = new NeutrxHeaders();
    for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        result.set(key, Array.isArray(value) ? value : String(value));
    }
    return result.toJSON();
}

export function toOutgoingHeaders(headers: Headers): OutgoingHttpHeaders {
    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)])
    );
}

export function getContentLength(headers: Headers): number | undefined {
    const value = headerToString(getHeader(headers, 'Content-Length'));
    const length = Number.parseInt(value, 10);
    return Number.isFinite(length) && length >= 0 ? length : undefined;
}

export function assertHeadersSafe(headers: Headers): void {
    const entries = Object.entries(headers);
    if (entries.length > 100) {
        throw new NeutrxSecurityError(`Too many headers: ${entries.length}`, { code: 'TOO_MANY_HEADERS' });
    }

    let totalSize = 0;
    for (const [key, value] of entries) {
        validateHeaderName(key);
        validateHeaderValue(key, value);
        totalSize += key.length + headerToString(value).length;
        if (totalSize > 8192) {
            throw new NeutrxSecurityError('Headers too large', { code: 'HEADERS_TOO_LARGE' });
        }
    }
}

export function normalizeHeaderKey(name: string): string {
    return name.toLowerCase();
}

function toHeaderArray(value: HeaderValue): string[] {
    return Array.isArray(value) ? (value as readonly string[]).map(item => String(item)) : [String(value)];
}

function isHeadersLike(value: HeaderSource): value is { readonly forEach: (callback: (value: string, key: string) => void) => void } {
    return typeof (value as { readonly forEach?: unknown }).forEach === 'function';
}

function isIterableHeaderSource(value: HeaderSource): value is Iterable<readonly [string, HeaderValue | string]> {
    return typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}
