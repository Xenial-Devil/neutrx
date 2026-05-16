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
import { assertHeadersSafe } from '../core/headers.js';
import type { Headers, InternalRequestConfig, JsonValue, NeutrxResponse, ParsedResponseData, RequestBody, SecurityConfig } from '../types.js';

const PRIVATE_HOST_PATTERNS = [
    /^localhost$/i,
    /^metadata$/i,
    /^metadata\.google\.internal$/i,
];

const DANGEROUS_PORTS = new Set([22, 23, 25, 53, 110, 143, 3306, 5432, 6379, 27017, 11211]);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_URL_LENGTH = 2048;
const MAX_OBJECT_DEPTH = 10;

interface NormalizedSecurityConfig {
    readonly profile: 'strict' | 'balanced' | 'axios-compatible';
    readonly allowedHosts?: readonly string[];
    readonly deniedHosts?: readonly string[];
    readonly allowedProtocols: readonly string[];
    readonly enforceHTTPS: boolean;
    readonly validateCertificate: boolean;
    readonly enableSSRFProtection: boolean;
    readonly blockPrivateIPs: boolean;
    readonly blockLinkLocalIPs: boolean;
    readonly blockLoopbackIPs: boolean;
    readonly blockMetadataIPs: boolean;
    readonly blockDangerousPorts: boolean;
    readonly reResolveOnRedirect: boolean;
    readonly blockRedirectToPrivateIP: boolean;
    readonly allowLocalhost: boolean;
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
        const profile = config.profile ?? 'balanced';
        const defaults = profileDefaults(profile);
        this.#config = {
            profile,
            ...(config.allowedHosts ? { allowedHosts: config.allowedHosts } : {}),
            ...(config.deniedHosts ? { deniedHosts: config.deniedHosts } : {}),
            allowedProtocols: config.allowedProtocols ?? defaults.allowedProtocols,
            enforceHTTPS: config.enforceHTTPS ?? defaults.enforceHTTPS,
            validateCertificate: config.validateCertificate ?? true,
            enableSSRFProtection: config.enableSSRFProtection ?? true,
            blockPrivateIPs: config.blockPrivateIPs ?? defaults.blockPrivateIPs,
            blockLinkLocalIPs: config.blockLinkLocalIPs ?? defaults.blockLinkLocalIPs,
            blockLoopbackIPs: config.blockLoopbackIPs ?? defaults.blockLoopbackIPs,
            blockMetadataIPs: config.blockMetadataIPs ?? defaults.blockMetadataIPs,
            blockDangerousPorts: config.blockDangerousPorts ?? defaults.blockDangerousPorts,
            reResolveOnRedirect: config.reResolveOnRedirect ?? true,
            blockRedirectToPrivateIP: config.blockRedirectToPrivateIP ?? true,
            allowLocalhost: config.allowLocalhost ?? defaults.allowLocalhost,
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

        if (!this.#config.allowedProtocols.map(protocol => `${protocol.replace(/:$/, '')}:`).includes(parsed.protocol)) {
            throw new NeutrxInjectionError('Protocol', parsed.protocol);
        }

        if (this.#config.enforceHTTPS && parsed.protocol !== 'https:' && (this.#config.profile === 'strict' || process.env.NODE_ENV === 'production')) {
            throw new NeutrxSecurityError('HTTPS required by security profile', { code: 'HTTPS_REQUIRED' });
        }

        if (this.#config.enableSSRFProtection) {
            this.#validateSSRF(parsed);
        }

        this.#detectURLInjection(url);
        return parsed;
    }

    validateRedirect(fromURL: string, toURL: string): void {
        const from = new URL(fromURL);
        const to = new URL(toURL);
        if (this.#config.enforceHTTPS && from.protocol === 'https:' && to.protocol === 'http:') {
            throw new NeutrxSecurityError('Redirect protocol downgrade blocked', { code: 'REDIRECT_PROTOCOL_DOWNGRADE' });
        }
        if (this.#config.blockRedirectToPrivateIP && this.#config.enableSSRFProtection) {
            this.#validateSSRF(to);
        }
    }

    validateHeader(key: string, value: Headers[string]): void {
        this.#validateHeaders({ [key]: value });
    }

    validateResolvedAddress(url: string, address: string): void {
        if (!this.#config.enableSSRFProtection) return;
        this.#assertHostAllowed(url, address, 'Resolved private/internal address');
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
        const hostname = normalizeHostname(parsed.hostname);

        if (this.#config.allowedHosts && !this.#config.allowedHosts.some(pattern => matchesHostPattern(hostname, pattern))) {
            throw new NeutrxSSRFError(parsed.href, `Host is not allowed: ${hostname}`);
        }
        if (this.#config.deniedHosts?.some(pattern => matchesHostPattern(hostname, pattern))) {
            throw new NeutrxSSRFError(parsed.href, `Host is denied: ${hostname}`);
        }

        for (const candidate of hostCandidates(hostname)) {
            this.#assertHostAllowed(parsed.href, candidate, 'Private/internal address');
        }

        const port = Number.parseInt(parsed.port, 10);
        if (this.#config.blockDangerousPorts && Number.isFinite(port) && DANGEROUS_PORTS.has(port)) {
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
        assertHeadersSafe(headers);
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
        return this.#sanitizeJson(value as JsonValue) as TBody;
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

    #assertHostAllowed(url: string, hostname: string, reasonPrefix: string): void {
        const normalized = normalizeHostname(hostname);
        if (!isPrivateOrInternalHost(normalized)) return;

        const category = hostCategory(normalized);
        if (category === 'metadata' && this.#config.blockMetadataIPs) {
            throw new NeutrxSSRFError(url, `${reasonPrefix}: ${normalized}`);
        }
        if (category === 'loopback' && (this.#config.blockLoopbackIPs || (!this.#config.allowLocalhost && this.#config.blockPrivateIPs))) {
            throw new NeutrxSSRFError(url, `${reasonPrefix}: ${normalized}`);
        }
        if (category === 'link-local' && this.#config.blockLinkLocalIPs) {
            throw new NeutrxSSRFError(url, `${reasonPrefix}: ${normalized}`);
        }
        if (category === 'private' && this.#config.blockPrivateIPs) {
            throw new NeutrxSSRFError(url, `${reasonPrefix}: ${normalized}`);
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

function profileDefaults(profile: NormalizedSecurityConfig['profile']): Pick<NormalizedSecurityConfig,
    'allowedProtocols'
    | 'enforceHTTPS'
    | 'blockPrivateIPs'
    | 'blockLinkLocalIPs'
    | 'blockLoopbackIPs'
    | 'blockMetadataIPs'
    | 'blockDangerousPorts'
    | 'allowLocalhost'
> {
    if (profile === 'strict') {
        return {
            allowedProtocols: ['https'],
            enforceHTTPS: true,
            blockPrivateIPs: true,
            blockLinkLocalIPs: true,
            blockLoopbackIPs: true,
            blockMetadataIPs: true,
            blockDangerousPorts: true,
            allowLocalhost: false,
        };
    }
    if (profile === 'axios-compatible') {
        return {
            allowedProtocols: ['http', 'https'],
            enforceHTTPS: false,
            blockPrivateIPs: false,
            blockLinkLocalIPs: false,
            blockLoopbackIPs: false,
            blockMetadataIPs: false,
            blockDangerousPorts: false,
            allowLocalhost: true,
        };
    }
    return {
        allowedProtocols: ['http', 'https'],
        enforceHTTPS: true,
        blockPrivateIPs: true,
        blockLinkLocalIPs: true,
        blockLoopbackIPs: true,
        blockMetadataIPs: true,
        blockDangerousPorts: true,
        allowLocalhost: false,
    };
}

function normalizeHostname(hostname: string): string {
    return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function hostCandidates(hostname: string): string[] {
    const candidates = new Set<string>([normalizeHostname(hostname)]);
    const decoded = safeDecodeURIComponent(hostname);
    candidates.add(normalizeHostname(decoded));
    const normalizedIPv4 = parseIPv4Variant(decoded);
    if (normalizedIPv4) candidates.add(normalizedIPv4);
    const mappedIPv4 = parseIPv4MappedIPv6(decoded);
    if (mappedIPv4) candidates.add(mappedIPv4);
    return [...candidates];
}

function isPrivateOrInternalHost(hostname: string): boolean {
    if (PRIVATE_HOST_PATTERNS.some(pattern => pattern.test(hostname))) return true;

    const ipVersion = net.isIP(hostname);
    if (ipVersion === 0) return false;
    if (ipVersion === 4) return hostCategory(hostname) !== 'public';
    return isPrivateIPv6(hostname);
}

function hostCategory(hostname: string): 'public' | 'loopback' | 'link-local' | 'metadata' | 'private' {
    if (/^localhost$/i.test(hostname)) return 'loopback';
    if (/^(metadata|metadata\.google\.internal)$/i.test(hostname)) return 'metadata';
    const ip = parseIPv4Variant(hostname) ?? hostname;
    if (net.isIP(ip) === 4) return ipv4Category(ip);
    if (net.isIP(ip) === 6) {
        const normalized = ip.toLowerCase();
        const mappedIPv4 = parseIPv4MappedIPv6(normalized);
        if (mappedIPv4) return ipv4Category(mappedIPv4);
        if (normalized === '::1') return 'loopback';
        if (normalized === 'fd00:ec2::254') return 'metadata';
        if (normalized.startsWith('fe80:')) return 'link-local';
        if (normalized.startsWith('fc') || normalized.startsWith('fd')) return 'private';
    }
    return 'public';
}

function ipv4Category(ip: string): 'public' | 'loopback' | 'link-local' | 'metadata' | 'private' {
    const parts = ip.split('.').map(part => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return 'public';
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    const c = parts[2] ?? 0;
    const d = parts[3] ?? 0;
    if (a === 169 && b === 254 && c === 169 && d === 254) return 'metadata';
    if (a === 100 && b === 100 && c === 100 && d === 200) return 'metadata';
    if (a === 127) return 'loopback';
    if (a === 169 && b === 254) return 'link-local';
    if (a === 0 || a === 10 || (a === 100 && b >= 64 && b <= 127) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
    return 'public';
}

function isPrivateIPv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

function parseIPv4Variant(hostname: string): string | null {
    const raw = hostname.toLowerCase();
    if (/^0x[0-9a-f]+$/i.test(raw) || /^\d+$/.test(raw)) {
        const numeric = Number.parseInt(raw, raw.startsWith('0x') ? 16 : 10);
        return numberToIPv4(numeric);
    }

    const parts = raw.split('.');
    if (parts.length !== 4) return null;
    const parsed = parts.map(part => {
        if (/^0x[0-9a-f]+$/i.test(part)) return Number.parseInt(part, 16);
        if (/^0[0-7]+$/.test(part)) return Number.parseInt(part, 8);
        if (/^\d+$/.test(part)) return Number.parseInt(part, 10);
        return Number.NaN;
    });
    if (parsed.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    return parsed.join('.');
}

function parseIPv4MappedIPv6(hostname: string): string | null {
    const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
    const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
    if (dotted?.[1]) return parseIPv4Variant(dotted[1]);

    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
    if (!hex?.[1] || !hex[2]) return null;
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    if (!Number.isInteger(high) || !Number.isInteger(low)) return null;
    return `${(high >>> 8) & 255}.${high & 255}.${(low >>> 8) & 255}.${low & 255}`;
}

function numberToIPv4(value: number): string | null {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
    return [
        (value >>> 24) & 255,
        (value >>> 16) & 255,
        (value >>> 8) & 255,
        value & 255,
    ].join('.');
}

function matchesHostPattern(hostname: string, pattern: string): boolean {
    const normalized = normalizeHostname(hostname);
    const raw = normalizeHostname(pattern);
    if (raw === '*') return true;
    if (raw.startsWith('*.')) return normalized === raw.slice(2) || normalized.endsWith(raw.slice(1));
    if (raw.startsWith('.')) return normalized === raw.slice(1) || normalized.endsWith(raw);
    return normalized === raw;
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
