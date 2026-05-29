import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

import { NeutrxInjectionError, NeutrxSecurityError } from './NeutrxError.js';
import type { Headers, HeaderSource, HeaderValue } from '../types.js';

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DANGEROUS_HEADER_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization']);

type HeaderEntry = {
    readonly name: string;
    readonly value: HeaderValue;
};

type ToJsonOptions = { readonly includeBlocked?: boolean };

export class NeutrxHeaders {
    #headers = new Map<string, HeaderEntry>();

    constructor(init?: HeaderSource) {
        if (init !== undefined) this.setAll(init);
        return proxiedHeaders(this);
    }

    static from(init?: HeaderSource): NeutrxHeaders {
        return isNeutrxHeadersLike(init) ? new NeutrxHeaders(init.toJSON({ includeBlocked: true })) : new NeutrxHeaders(init);
    }

    static concat(...sources: readonly (HeaderSource | undefined)[]): NeutrxHeaders {
        const result = new NeutrxHeaders();
        for (const source of sources) {
            if (source !== undefined) result.setAll(source);
        }
        return result.normalize();
    }

    set(name: string, value: HeaderValue | null | undefined): this {
        validateHeaderName(name);
        if (value === null || value === undefined) {
            this.#headers.delete(normalizeHeaderKey(name));
            return this;
        }
        validateHeaderValue(name, value);

        const key = normalizeHeaderKey(name);
        const existing = this.#headers.get(key);
        if (key === 'set-cookie' && existing && existing.value !== false && value !== false) {
            this.#headers.set(key, {
                name: existing.name,
                value: [...toHeaderArray(existing.value), ...toHeaderArray(value)],
            });
            return this;
        }

        this.#headers.set(key, { name: existing?.name ?? name, value });
        return this;
    }

    setIfUnset(name: string, value: HeaderValue): this {
        return this.has(name) ? this : this.set(name, value);
    }

    setIfNotBlocked(name: string, value: HeaderValue): this {
        return this.get(name) === false ? this : this.set(name, value);
    }

    setAll(source: HeaderSource): this {
        if (isNeutrxHeadersLike(source)) {
            for (const [name, value] of Object.entries(source.toJSON({ includeBlocked: true }))) this.set(name, value);
            return this;
        }

        if (isHeadersLike(source)) {
            source.forEach((value, key) => this.set(key, value));
            return this;
        }

        if (isIterableHeaderSource(source)) {
            for (const [name, value] of source) this.set(name, value);
            return this;
        }

        for (const name of Object.keys(source)) {
            const value = source[name];
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

    toJSON(options: ToJsonOptions = {}): Headers {
        const result: Headers = {};
        for (const { name, value } of this.#headers.values()) {
            if (value === false && options.includeBlocked !== true) continue;
            result[name] = value;
        }
        return result;
    }

    getSetCookie(): string[] {
        const value = this.#headers.get('set-cookie')?.value;
        if (value === undefined || value === false) return [];
        return toHeaderArray(value);
    }

    setContentType(value: string | false | null): this {
        return this.set('Content-Type', value);
    }

    getContentType(): string | undefined {
        const value = this.get('Content-Type');
        return value === undefined || value === false ? undefined : headerToString(value);
    }

    getAuthorization(): string | undefined {
        const value = this.get('Authorization');
        return value === undefined || value === false ? undefined : headerToString(value);
    }

    setAccept(value: string | false | null): this {
        return this.set('Accept', value);
    }

    setAuthorization(value: string | false | null): this {
        return this.set('Authorization', value);
    }

    setUserAgent(value: string | false | null): this {
        return this.set('User-Agent', value);
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
            if (value === false) continue;
            result[name] = SENSITIVE_HEADERS.has(normalizeHeaderKey(name))
                ? Array.isArray(value) ? value.map(() => redaction) : redaction
                : value;
        }
        return result;
    }

    keys(): IterableIterator<string> {
        return this.#visibleEntries().keys();
    }

    values(): IterableIterator<HeaderValue> {
        return this.#visibleEntries().values();
    }

    entries(): IterableIterator<[string, HeaderValue]> {
        return this[Symbol.iterator]();
    }

    forEach(callback: (value: HeaderValue, key: string, headers: NeutrxHeaders) => void, thisArg?: unknown): void {
        for (const [name, value] of this) callback.call(thisArg, value, name, this);
    }

    *[Symbol.iterator](): IterableIterator<[string, HeaderValue]> {
        for (const [name, value] of this.#visibleEntries()) yield [name, value];
    }

    #visibleEntries(): Map<string, HeaderValue> {
        const entries = new Map<string, HeaderValue>();
        for (const { name, value } of this.#headers.values()) {
            if (value !== false) entries.set(name, value);
        }
        return entries;
    }
}

export function validateHeaderName(name: string): void {
    if (!name || !HEADER_NAME_RE.test(name) || DANGEROUS_HEADER_NAMES.has(normalizeHeaderKey(name))) {
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

export function hasHeader(headers: Headers | NeutrxHeaders, key: string): boolean {
    return NeutrxHeaders.from(headers).has(key);
}

export function getHeader(headers: Headers | NeutrxHeaders, key: string): HeaderValue | undefined {
    return NeutrxHeaders.from(headers).get(key);
}

export function setHeader(headers: Headers | NeutrxHeaders, key: string, value: HeaderValue): void {
    if (headers instanceof NeutrxHeaders) {
        headers.set(key, value);
        return;
    }
    const next = NeutrxHeaders.from(headers).set(key, value).toJSON();
    for (const existing of Object.keys(headers)) delete headers[existing];
    Object.assign(headers, next);
}

export function deleteHeader(headers: Headers | NeutrxHeaders, key: string): void {
    if (headers instanceof NeutrxHeaders) {
        headers.delete(key);
        return;
    }
    const next = NeutrxHeaders.from(headers);
    next.delete(key);
    for (const existing of Object.keys(headers)) delete headers[existing];
    Object.assign(headers, next.toJSON());
}

export function headerToString(value: Headers[string] | undefined): string {
    if (value == null) return '';
    if (value === false) return '';
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

export function toOutgoingHeaders(headers: Headers | NeutrxHeaders): OutgoingHttpHeaders {
    const normalized = NeutrxHeaders.from(headers).toJSON();
    return Object.fromEntries(
        Object.entries(normalized).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)])
    );
}

export function getContentLength(headers: Headers | NeutrxHeaders): number | undefined {
    const value = headerToString(getHeader(headers, 'Content-Length'));
    const length = Number.parseInt(value, 10);
    return Number.isFinite(length) && length >= 0 ? length : undefined;
}

export function assertHeadersSafe(headers: Headers | NeutrxHeaders): void {
    const entries = Object.entries(NeutrxHeaders.from(headers).toJSON());
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

function isIterableHeaderSource(value: HeaderSource): value is Iterable<readonly [string, HeaderValue | null | undefined]> {
    return typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

function isNeutrxHeadersLike(value: HeaderSource | undefined): value is NeutrxHeaders {
    return value instanceof NeutrxHeaders
        || (
            value !== undefined
            && value !== null
            && typeof value === 'object'
            && typeof (value as { readonly get?: unknown }).get === 'function'
            && typeof (value as { readonly has?: unknown }).has === 'function'
            && typeof (value as { readonly set?: unknown }).set === 'function'
            && typeof (value as { readonly toJSON?: unknown }).toJSON === 'function'
        );
}

function proxiedHeaders(target: NeutrxHeaders): NeutrxHeaders {
    return new Proxy(target, {
        get(headers, property, receiver): unknown {
            if (typeof property === 'string' && !Reflect.has(headers, property) && headers.has(property)) {
                return headers.get(property);
            }

            if (property === 'forEach') {
                return (
                    callback: (value: HeaderValue, key: string, headerCollection: NeutrxHeaders) => void,
                    thisArg?: unknown
                ): void => {
                    headers.forEach((value, name) => callback.call(thisArg, value, name, receiver as NeutrxHeaders));
                };
            }

            const value: unknown = Reflect.get(headers, property, headers);
            if (typeof value !== 'function') return value;

            return (...args: unknown[]): unknown => {
                const result = (value as (...methodArgs: unknown[]) => unknown).apply(headers, args);
                return result === headers ? receiver : result;
            };
        },
        set(headers, property, value): boolean {
            if (typeof property !== 'string' || Reflect.has(headers, property)) {
                return Reflect.set(headers, property, value, headers);
            }
            headers.set(property, value as HeaderValue | null | undefined);
            return true;
        },
        deleteProperty(headers, property): boolean {
            if (typeof property === 'string' && !Reflect.has(headers, property)) {
                return headers.delete(property);
            }
            return Reflect.deleteProperty(headers, property);
        },
        has(headers, property): boolean {
            return Reflect.has(headers, property) || (typeof property === 'string' && headers.has(property));
        },
        ownKeys(headers): ArrayLike<string | symbol> {
            return [...new Set([...Reflect.ownKeys(headers), ...headers.keys()])];
        },
        getOwnPropertyDescriptor(headers, property): PropertyDescriptor | undefined {
            if (typeof property === 'string' && headers.has(property)) {
                const value = headers.get(property);
                if (value !== undefined && value !== false) {
                    return {
                        configurable: true,
                        enumerable: true,
                        value,
                        writable: true,
                    };
                }
            }
            return Reflect.getOwnPropertyDescriptor(headers, property);
        },
    });
}
