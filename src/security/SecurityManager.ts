import crypto from 'node:crypto';
import net from 'node:net';
import { Readable } from 'node:stream';
import tls from 'node:tls';
import type { PeerCertificate } from 'node:tls';

import {
    NeutrxCertPinError,
    NeutrxInjectionError,
    NeutrxPrototypePollutionError,
    NeutrxSSRFError,
    NeutrxSecurityError,
} from '../core/NeutrxError.js';
import type { Headers, InternalRequestConfig, JsonValue, NeutrxResponse, ParsedResponseData, RequestBody, SecurityConfig } from '../types.js';

const PRIVATE_HOST_PATTERNS = [
    /^localhost$/i,
    /^metadata\.google\.internal$/i,
];

const DANGEROUS_PORTS = new Set([22, 23, 25, 53, 110, 143, 3306, 5432, 6379, 27017, 11211]);
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_URL_LENGTH = 2048;
const MAX_HEADER_SIZE = 8192;
const MAX_HEADER_COUNT = 100;
const MAX_OBJECT_DEPTH = 10;

interface NormalizedSecurityConfig {
    readonly enforceHTTPS: boolean;
    readonly validateCertificate: boolean;
    readonly enableSSRFProtection: boolean;
    readonly blockPrivateIPs: boolean;
    readonly sanitizeInputs: boolean;
    readonly sanitizeOutputs: boolean;
}

export default class SecurityManager {
    #config: NormalizedSecurityConfig;
    #pinnedCerts = new Map<string, string>();
    #blocklist = new Set<string>();
    #signingSecret: string | null = null;
    #signingAlgo = 'sha256';

    constructor(config: SecurityConfig = {}) {
        this.#config = {
            enforceHTTPS: config.enforceHTTPS ?? true,
            validateCertificate: config.validateCertificate ?? true,
            enableSSRFProtection: config.enableSSRFProtection ?? true,
            blockPrivateIPs: config.blockPrivateIPs ?? true,
            sanitizeInputs: config.sanitizeInputs ?? true,
            sanitizeOutputs: config.sanitizeOutputs ?? true,
        };
    }

    validateRequest<TBody extends RequestBody>(config: InternalRequestConfig<TBody>): InternalRequestConfig<TBody> {
        this.validateURL(config.url);
        this.#validateMethod(config.method);
        this.#validateHeaders(config.headers);
        this.#checkBlocklist(config.url);

        let next = config;
        if (config.data !== undefined && this.#config.sanitizeInputs) {
            next = { ...next, data: this.#sanitizeBody(config.data) };
        }

        if (this.#signingSecret) {
            next = this.#signRequest(next);
        }

        return {
            ...next,
            headers: this.#injectSecurityHeaders(next.headers, next.requestId),
        };
    }

    sanitizeResponse<TData extends ParsedResponseData>(response: NeutrxResponse<TData>): NeutrxResponse<TData> {
        if (!this.#config.sanitizeOutputs) return response;

        if (typeof response.data === 'string') {
            response.data = this.#sanitizeString(response.data) as TData;
            return response;
        }

        if (isJsonContainer(response.data)) {
            response.data = this.#sanitizeJson(response.data) as TData;
        }

        return response;
    }

    validateURL(url: string): URL {
        if (!url || typeof url !== 'string') {
            throw new NeutrxSecurityError('URL must be a non-empty string', { code: 'INVALID_URL' });
        }

        if (url.length > MAX_URL_LENGTH) {
            throw new NeutrxSecurityError(`URL too long: ${url.length} > ${MAX_URL_LENGTH}`, { code: 'URL_TOO_LONG' });
        }

        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw new NeutrxSecurityError(`Malformed URL: ${url}`, { code: 'MALFORMED_URL' });
        }

        if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
            throw new NeutrxInjectionError('Protocol', parsed.protocol);
        }

        if (this.#config.enforceHTTPS && parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
            throw new NeutrxSecurityError('HTTPS required in production', { code: 'HTTPS_REQUIRED' });
        }

        if (this.#config.enableSSRFProtection) {
            this.#validateSSRF(parsed);
        }

        this.#detectURLInjection(url);
        return parsed;
    }

    validateHeader(key: string, value: Headers[string]): void {
        this.#validateHeaders({ [key]: value });
    }

    validateResolvedAddress(url: string, address: string): void {
        if (!this.#config.enableSSRFProtection || !this.#config.blockPrivateIPs) return;
        if (isPrivateOrInternalHost(address)) {
            throw new NeutrxSSRFError(url, `Resolved private/internal address: ${address}`);
        }
    }

    pinCertificate(hostname: string, fingerprint: string): void {
        const clean = fingerprint.replace(/[: ]/g, '').toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(clean)) {
            throw new NeutrxSecurityError('Invalid SHA-256 fingerprint', { code: 'INVALID_FINGERPRINT' });
        }
        this.#pinnedCerts.set(hostname.toLowerCase(), clean);
    }

    checkServerIdentity(hostname: string, cert: PeerCertificate): Error | undefined {
        const pinned = this.#pinnedCerts.get(hostname.toLowerCase());
        if (pinned) {
            const actual = (cert.fingerprint256 ?? '').replace(/[: ]/g, '').toLowerCase();
            if (actual !== pinned) throw new NeutrxCertPinError(hostname);
        }
        return tls.checkServerIdentity(hostname, cert);
    }

    blockDomain(domain: string): void {
        this.#blocklist.add(domain.toLowerCase().trim());
    }

    enableSigning(secret: string, algorithm = 'sha256'): void {
        if (!secret) {
            throw new NeutrxSecurityError('Signing secret is required', { code: 'SIGNING_SECRET_REQUIRED' });
        }
        this.#signingSecret = secret;
        this.#signingAlgo = algorithm;
    }

    #validateSSRF(parsed: URL): void {
        const hostname = parsed.hostname.toLowerCase();

        if (this.#config.blockPrivateIPs && isPrivateOrInternalHost(hostname)) {
            throw new NeutrxSSRFError(parsed.href, `Private/internal address: ${hostname}`);
        }

        const decoded = safeDecodeURIComponent(hostname);
        if (decoded !== hostname && this.#config.blockPrivateIPs && isPrivateOrInternalHost(decoded)) {
            throw new NeutrxSSRFError(parsed.href, `URL-encoded bypass attempt: ${decoded}`);
        }

        const port = Number.parseInt(parsed.port, 10);
        if (Number.isFinite(port) && DANGEROUS_PORTS.has(port)) {
            throw new NeutrxSSRFError(parsed.href, `Dangerous port: ${port}`);
        }
    }

    #detectURLInjection(url: string): void {
        const patterns: readonly [RegExp, string][] = [
            [/%00/i, 'Null byte'],
            [/\.\.\//, 'Path traversal'],
            [/javascript:/i, 'JavaScript protocol'],
            [/data:/i, 'Data URI'],
            [/vbscript:/i, 'VBScript'],
            [/file:/i, 'File protocol'],
            [/<script/i, 'Script tag'],
        ];

        for (const [pattern, type] of patterns) {
            if (pattern.test(url)) throw new NeutrxInjectionError(type, 'URL');
        }
    }

    #validateMethod(method: string): void {
        const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
        if (!allowed.has(method.toUpperCase())) {
            throw new NeutrxSecurityError(`Invalid HTTP method: ${method}`, { code: 'INVALID_METHOD' });
        }
    }

    #validateHeaders(headers: Headers): void {
        const entries = Object.entries(headers);
        if (entries.length > MAX_HEADER_COUNT) {
            throw new NeutrxSecurityError(`Too many headers: ${entries.length}`, { code: 'TOO_MANY_HEADERS' });
        }

        let totalSize = 0;
        for (const [key, value] of entries) {
            if (!/^[a-zA-Z0-9\-_]+$/.test(key)) {
                throw new NeutrxInjectionError('Header name', key);
            }

            const rendered = Array.isArray(value) ? value.join(',') : String(value);
            if (/[\r\n]/.test(`${key}${rendered}`)) {
                throw new NeutrxInjectionError('CRLF header injection', key);
            }

            totalSize += key.length + rendered.length;
            if (totalSize > MAX_HEADER_SIZE) {
                throw new NeutrxSecurityError('Headers too large', { code: 'HEADERS_TOO_LARGE' });
            }
        }
    }

    #sanitizeBody<TBody extends RequestBody>(value: TBody): TBody {
        if (typeof value === 'string') return this.#sanitizeString(value) as TBody;
        if (value === null || typeof value !== 'object') return value;
        if (
            Buffer.isBuffer(value)
            || value instanceof URLSearchParams
            || value instanceof Readable
            || value instanceof ArrayBuffer
            || ArrayBuffer.isView(value)
            || isBlobLike(value)
            || isFormDataLike(value)
        ) return value;
        return this.#sanitizeJson(value) as TBody;
    }

    #sanitizeJson(value: JsonValue, depth = 0): JsonValue {
        if (depth > MAX_OBJECT_DEPTH) {
            throw new NeutrxSecurityError('Object depth limit exceeded', { code: 'DEPTH_EXCEEDED' });
        }

        if (typeof value === 'string') return this.#sanitizeString(value);
        if (typeof value !== 'object' || value === null) return value;

        if (Array.isArray(value)) {
            const items: readonly JsonValue[] = value;
            return items.map(item => this.#sanitizeJson(item, depth + 1));
        }

        const result: Record<string, JsonValue> = {};
        for (const [key, child] of Object.entries(value)) {
            if (DANGEROUS_KEYS.has(key)) throw new NeutrxPrototypePollutionError(key);
            result[key] = this.#sanitizeJson(child, depth + 1);
        }
        return result;
    }

    #sanitizeString(value: string): string {
        const sanitized = value.replace(/\0/g, '');
        if (DANGEROUS_KEYS.has(sanitized.trim())) {
            throw new NeutrxPrototypePollutionError(sanitized);
        }
        return sanitized;
    }

    #checkBlocklist(url: string): void {
        try {
            const { hostname } = new URL(url);
            if (this.#blocklist.has(hostname.toLowerCase())) {
                throw new NeutrxSecurityError(`Blocked domain: ${hostname}`, { code: 'DOMAIN_BLOCKED' });
            }
        } catch (error: unknown) {
            if (error instanceof NeutrxSecurityError) throw error;
        }
    }

    #signRequest<TBody extends RequestBody>(config: InternalRequestConfig<TBody>): InternalRequestConfig<TBody> {
        const timestamp = Date.now().toString();
        const body = config.data === undefined ? '' : serializeForSignature(config.data);
        const payload = `${config.method}:${config.url}:${timestamp}:${body}`;
        const signature = crypto
            .createHmac(this.#signingAlgo, this.#signingSecret ?? '')
            .update(payload)
            .digest('hex');

        return {
            ...config,
            headers: {
                ...config.headers,
                'X-Neutrx-Timestamp': timestamp,
                'X-Neutrx-Signature': signature,
            },
        };
    }

    #injectSecurityHeaders(headers: Headers, requestId: string): Headers {
        return {
            ...headers,
            'X-Request-ID': requestId,
            'X-Content-Type-Options': 'nosniff',
        };
    }
}

function isJsonContainer(value: ParsedResponseData): value is JsonValue {
    return value !== null && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof URLSearchParams) && !('pipe' in value);
}

function serializeForSignature(data: RequestBody): string {
    if (typeof data === 'string') return data;
    if (Buffer.isBuffer(data)) return data.toString('base64');
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString('base64');
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
    if (data instanceof URLSearchParams) return data.toString();
    if (data instanceof Readable) return '[stream]';
    if (isBlobLike(data)) return `[blob:${data.size}]`;
    if (isFormDataLike(data)) return '[form-data]';
    return JSON.stringify(data);
}

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function isPrivateOrInternalHost(hostname: string): boolean {
    if (PRIVATE_HOST_PATTERNS.some(pattern => pattern.test(hostname))) return true;

    const ipVersion = net.isIP(hostname);
    if (ipVersion === 0) return false;
    if (ipVersion === 4) return isPrivateIPv4(hostname);
    return isPrivateIPv6(hostname);
}

function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map(part => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
    );
}

function isPrivateIPv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
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
