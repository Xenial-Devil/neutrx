import crypto from 'node:crypto';
import http2 from 'node:http2';
import { PassThrough, Readable } from 'node:stream';
import type { PeerCertificate } from 'node:tls';

import type SecurityManager from '../security/SecurityManager.js';
import { abortError } from '../core/cancel.js';
import { createLookup } from '../core/dns.js';
import {
    NeutrxConnectTimeoutError,
    NeutrxError,
    NeutrxErrorFactory,
    NeutrxRequestSizeError,
    NeutrxResponseSizeError,
    NeutrxResponseTimeoutError,
    NeutrxSecurityError,
    axiosTimeoutErrorCode,
} from '../core/NeutrxError.js';
import { serializeBody } from '../core/bodySerializer.js';
import { NeutrxHeaders, getContentLength, hasHeader, normalizeIncomingHeaders, setHeader } from '../core/headers.js';
import { reportDownloadProgress, reportUploadProgress, toUploadBuffer } from '../core/progress.js';
import type {
    Headers,
    Http2SessionStats,
    InternalHeaders,
    InternalRequestConfig,
    LookupFunction,
    NormalizedClientConfig,
    RawHttpResponse,
    RequestAdapter,
    TlsConfig,
} from '../types.js';

type RuntimeRequestConfig = InternalRequestConfig & { headers: InternalHeaders };
type Http2ConnectOptions = http2.SecureClientSessionOptions & { readonly lookup?: LookupFunction };

export interface NodeHttp2AdapterOptions {
    readonly security?: SecurityManager;
    readonly defaults?: Pick<NormalizedClientConfig, 'lookup' | 'security' | 'tls'>;
}

interface SessionRecord {
    readonly key: string;
    readonly origin: string;
    readonly owner?: object;
    readonly session: http2.ClientHttp2Session;
    readonly ready: Promise<void>;
    activeStreams: number;
}

const sessions = new Map<string, SessionRecord>();
const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

export function createNodeHttp2Adapter(options: NodeHttp2AdapterOptions): RequestAdapter {
    return config => http2Adapter(config, options);
}

export async function http2Adapter(config: InternalRequestConfig, options: NodeHttp2AdapterOptions = {}): Promise<RawHttpResponse> {
    const runtimeConfig: RuntimeRequestConfig = { ...config, headers: NeutrxHeaders.from(config.headers) as unknown as InternalHeaders };
    const url = new URL(runtimeConfig.url);

    if (runtimeConfig.proxy) {
        throw new NeutrxSecurityError('HTTP/2 adapter does not support proxy tunneling; use HTTP/1.1 for proxied requests', {
            code: 'HTTP2_PROXY_UNSUPPORTED',
        });
    }
    if (runtimeConfig.socketPath) {
        throw new NeutrxSecurityError('HTTP/2 adapter does not support socketPath; use HTTP/1.1 for Unix sockets', {
            code: 'HTTP2_SOCKET_UNSUPPORTED',
        });
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new NeutrxSecurityError(`HTTP/2 adapter cannot handle protocol ${url.protocol}`, { code: 'HTTP2_PROTOCOL_UNSUPPORTED' });
    }

    const body = runtimeConfig.data === undefined ? null : await serializeBody(runtimeConfig);
    if (body !== null && !(body instanceof Readable) && !hasHeader(runtimeConfig.headers, 'Content-Length')) {
        setHeader(runtimeConfig.headers, 'Content-Length', Buffer.byteLength(body));
    }

    if (runtimeConfig.signal?.aborted) throw abortError(runtimeConfig.signal);

    const tlsConfig = runtimeConfig.tls ?? options.defaults?.tls;
    if (runtimeConfig.tls?.certificatePins) options.security?.setCertificatePins(runtimeConfig.tls.certificatePins);
    const configuredLookup = runtimeConfig.lookup ?? options.defaults?.lookup;
    const lookup = options.security
        ? await createLookup(url, runtimeConfig, options.security, options.defaults?.lookup)
        : configuredLookup;
    const origin = url.origin;
    const record = await getSession(origin, url, runtimeConfig, tlsConfig, lookup, configuredLookup, options);
    const streamLimit = streamLimitFor(record, runtimeConfig.http2Options?.maxConcurrentStreams);
    if (record.activeStreams >= streamLimit) {
        throw Object.assign(
            new Error(`HTTP/2 max concurrent streams reached for ${origin}: ${streamLimit}`),
            { code: 'HTTP2_MAX_CONCURRENT_STREAMS' }
        );
    }

    const requestHeaders: http2.OutgoingHttpHeaders = {
        ':method': runtimeConfig.method,
        ':path': `${url.pathname}${url.search}`,
        ':scheme': url.protocol.slice(0, -1),
        ':authority': url.host,
        ...toHttp2Headers(runtimeConfig.headers),
    };

    return new Promise((resolve, reject) => {
        const request = record.session.request(requestHeaders);
        record.activeStreams += 1;

        const chunks: Buffer[] = [];
        let received = 0;
        let responseHeaders: http2.IncomingHttpHeaders = {};
        let normalizedHeaders: Headers = {};
        let status = 0;
        let settled = false;

        const finish = (response: RawHttpResponse): void => {
            if (settled) return;
            settled = true;
            resolve(response);
        };

        const fail = (error: Error): void => {
            if (settled) return;
            settled = true;
            request.destroy(error);
            reject(error);
        };

        request.once('close', () => {
            record.activeStreams = Math.max(0, record.activeStreams - 1);
        });
        request.setTimeout(runtimeConfig.timeout, () => {
            const error = new NeutrxResponseTimeoutError(runtimeConfig.url, runtimeConfig.timeout, {
                code: axiosTimeoutErrorCode(runtimeConfig.transitional),
            });
            if (settled) {
                request.destroy(error);
                return;
            }
            fail(error);
        });

        request.once('response', headersMap => {
            responseHeaders = headersMap;
            normalizedHeaders = normalizeHttp2Headers(headersMap);
            const rawStatus = headersMap[':status'];
            status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus ?? 0);
            const total = getContentLength(normalizedHeaders);
            reportDownloadProgress(runtimeConfig, 0, total);

            if (runtimeConfig.responseType === 'stream') {
                finish({
                    status,
                    statusText: String(status),
                    headers: normalizedHeaders,
                    data: createDownloadStream(request, runtimeConfig, total),
                    config: { ...runtimeConfig, headers: runtimeConfig.headers },
                    request,
                });
            }
        });

        request.on('data', chunk => {
            if (runtimeConfig.responseType === 'stream') return;

            const buffer = toTransferBuffer(chunk);
            received += buffer.length;
            if (received > runtimeConfig.maxContentLength) {
                fail(new NeutrxResponseSizeError(received, runtimeConfig.maxContentLength));
                return;
            }
            chunks.push(buffer);
            reportDownloadProgress(runtimeConfig, received, getContentLength(normalizedHeaders));
        });

        request.once('end', () => {
            if (runtimeConfig.responseType === 'stream' || settled) return;
            finish({
                status,
                statusText: String(status),
                headers: normalizeHttp2Headers(responseHeaders),
                data: Buffer.concat(chunks),
                config: { ...runtimeConfig, headers: runtimeConfig.headers },
                request,
            });
        });

        request.once('error', error => {
            fail(normalizeTransportError(error, runtimeConfig));
        });

        runtimeConfig.signal?.addEventListener('abort', () => {
            fail(abortError(runtimeConfig.signal));
        }, { once: true });

        if (body instanceof Readable) {
            writeStreamBody(request, body, runtimeConfig, fail);
            return;
        }
        if (body !== null) {
            const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
            if (payload.length > runtimeConfig.maxBodyLength) {
                fail(new NeutrxRequestSizeError(payload.length, runtimeConfig.maxBodyLength));
                return;
            }
            reportUploadProgress(runtimeConfig, 0, payload.length);
            request.end(payload, () => reportUploadProgress(runtimeConfig, payload.length, payload.length));
            return;
        }
        request.end();
    });
}

export function closeHttp2Sessions(owner?: object): void {
    for (const [key, record] of sessions) {
        if (owner === undefined || record.owner === owner) retireSession(key);
    }
}

export function getHttp2SessionStats(): Http2SessionStats {
    const origins: Http2SessionStats['origins'] = {};
    for (const record of sessions.values()) {
        const existing = origins[record.origin];
        const remoteMax = record.session.remoteSettings.maxConcurrentStreams;
        origins[record.origin] = {
            activeStreams: (existing?.activeStreams ?? 0) + record.activeStreams,
            closed: (existing?.closed ?? true) && record.session.closed,
            destroyed: (existing?.destroyed ?? true) && record.session.destroyed,
            sessionCount: (existing?.sessionCount ?? 0) + 1,
            ...(remoteMax !== undefined ? { remoteMaxConcurrentStreams: remoteMax } : {}),
        };
    }
    return { sessions: sessions.size, origins };
}

async function getSession(
    origin: string,
    url: URL,
    config: RuntimeRequestConfig,
    tlsConfig: TlsConfig | undefined,
    lookup: LookupFunction | undefined,
    lookupKey: LookupFunction | undefined,
    options: NodeHttp2AdapterOptions
): Promise<SessionRecord> {
    const rejectUnauthorized = tlsConfig?.rejectUnauthorized ?? config.http2Options?.rejectUnauthorized ?? options.defaults?.security.validateCertificate;
    const key = sessionKey(origin, tlsConfig, rejectUnauthorized, lookupKey, options.security);
    const existing = sessions.get(key);
    if (existing && !existing.session.closed && !existing.session.destroyed) {
        await existing.ready;
        return existing;
    }

    const maxSessions = positiveInteger(config.http2Options?.maxSessions);
    const ownedSessions = [...sessions.values()].filter(record => record.owner === options.security);
    if (maxSessions !== undefined && ownedSessions.length >= maxSessions) {
        const first = ownedSessions[0];
        if (first) retireSession(first.key);
    }

    const connectOptions = createConnectOptions(url, config, tlsConfig, lookup, options);
    const session = http2.connect(origin, connectOptions);
    const ready = waitForSessionConnect(session, config, key);
    const record: SessionRecord = {
        key,
        origin,
        ...(options.security ? { owner: options.security } : {}),
        session,
        ready,
        activeStreams: 0,
    };
    sessions.set(key, record);

    const sessionTimeout = positiveInteger(config.http2Options?.sessionTimeout);
    if (sessionTimeout !== undefined) {
        session.setTimeout(sessionTimeout, () => retireSession(key));
    }
    session.on('close', () => sessions.delete(key));
    session.on('error', () => sessions.delete(key));
    session.on('goaway', () => retireSession(key));

    await ready;
    return record;
}

function createConnectOptions(
    url: URL,
    config: RuntimeRequestConfig,
    tlsConfig: TlsConfig | undefined,
    lookup: LookupFunction | undefined,
    options: NodeHttp2AdapterOptions
): Http2ConnectOptions {
    const isSecure = url.protocol === 'https:';
    return {
        ...(lookup ? { lookup } : {}),
        ...(isSecure
            ? {
                rejectUnauthorized: tlsConfig?.rejectUnauthorized ?? config.http2Options?.rejectUnauthorized ?? options.defaults?.security.validateCertificate,
                ...(tlsConfig?.ca !== undefined ? { ca: tlsConfig.ca } : {}),
                ...(tlsConfig?.cert !== undefined ? { cert: tlsConfig.cert } : {}),
                ...(tlsConfig?.key !== undefined ? { key: tlsConfig.key } : {}),
                ...(tlsConfig?.pfx !== undefined ? { pfx: tlsConfig.pfx } : {}),
                ...(tlsConfig?.passphrase !== undefined ? { passphrase: tlsConfig.passphrase } : {}),
                ...(tlsConfig?.servername !== undefined ? { servername: tlsConfig.servername } : {}),
                ...(options.security
                    ? {
                        checkServerIdentity: (host: string, cert: PeerCertificate): Error | undefined => options.security?.checkServerIdentity(host, cert),
                    }
                    : {}),
            }
            : {}),
    };
}

function waitForSessionConnect(session: http2.ClientHttp2Session, config: RuntimeRequestConfig, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const connectTimer = setTimeout(() => {
            if (settled) return;
            settled = true;
            session.destroy();
            sessions.delete(key);
            reject(new NeutrxConnectTimeoutError(config.url, config.connectTimeout, {
                code: axiosTimeoutErrorCode(config.transitional),
            }));
        }, config.connectTimeout);

        const cleanup = (): void => {
            clearTimeout(connectTimer);
            session.off('connect', onConnect);
            session.off('error', onError);
        };
        const onConnect = (): void => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };
        const onError = (error: Error): void => {
            if (settled) return;
            settled = true;
            cleanup();
            sessions.delete(key);
            reject(normalizeTransportError(error, config));
        };

        session.once('connect', onConnect);
        session.once('error', onError);
    });
}

function retireSession(key: string): void {
    const record = sessions.get(key);
    if (!record) return;
    sessions.delete(key);
    record.session.close();
}

function streamLimitFor(record: SessionRecord, localLimit?: number): number {
    const remoteLimit = record.session.remoteSettings.maxConcurrentStreams;
    const candidates = [
        Number.isFinite(localLimit) && localLimit ? localLimit : Number.POSITIVE_INFINITY,
        Number.isFinite(remoteLimit) && remoteLimit ? remoteLimit : Number.POSITIVE_INFINITY,
    ];
    return Math.max(1, Math.min(...candidates));
}

function toHttp2Headers(headers: Headers): http2.OutgoingHttpHeaders {
    const result: http2.OutgoingHttpHeaders = {};
    const forbidden = new Set(['connection', 'host', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade']);
    for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (lower.startsWith(':') || forbidden.has(lower)) continue;
        if (lower === 'te' && String(value).toLowerCase() !== 'trailers') continue;
        result[lower] = Array.isArray(value) ? value.map(item => String(item)) : String(value);
    }
    return result;
}

function normalizeHttp2Headers(headers: http2.IncomingHttpHeaders): Headers {
    const filtered: http2.IncomingHttpHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
        if (key.startsWith(':')) continue;
        filtered[key] = value;
    }
    return normalizeIncomingHeaders(filtered);
}

function createDownloadStream(request: http2.ClientHttp2Stream, config: RuntimeRequestConfig, total?: number): Readable {
    const stream = new PassThrough();
    let loaded = 0;

    request.on('data', chunk => {
        const buffer = toTransferBuffer(chunk);
        loaded += buffer.length;
        if (loaded > config.maxContentLength) {
            request.destroy(new NeutrxResponseSizeError(loaded, config.maxContentLength));
            return;
        }
        reportDownloadProgress(config, loaded, total);
    });
    request.once('error', error => stream.destroy(normalizeError(error)));
    request.pipe(stream);
    return stream;
}

function writeStreamBody(
    request: http2.ClientHttp2Stream,
    stream: Readable,
    config: RuntimeRequestConfig,
    fail: (error: Error) => void
): void {
    const total = getContentLength(config.headers);
    if (total !== undefined && total > config.maxBodyLength) {
        fail(new NeutrxRequestSizeError(total, config.maxBodyLength));
        return;
    }

    let loaded = 0;
    reportUploadProgress(config, loaded, total);

    void (async () => {
        for await (const chunk of stream) {
            const buffer = toUploadBuffer(chunk);
            loaded += buffer.length;
            if (loaded > config.maxBodyLength) {
                throw new NeutrxRequestSizeError(loaded, config.maxBodyLength);
            }
            await writeRequestChunk(request, buffer);
            reportUploadProgress(config, loaded, total);
        }
        request.end();
    })().catch(error => fail(normalizeError(error)));
}

function writeRequestChunk(request: http2.ClientHttp2Stream, chunk: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        request.write(chunk, error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function sessionKey(
    origin: string,
    tlsConfig: TlsConfig | undefined,
    rejectUnauthorized: boolean | undefined,
    lookup: LookupFunction | undefined,
    owner: object | undefined
): string {
    return [
        origin,
        `owner=${owner ? objectId(owner) : 'shared'}`,
        `reject=${String(tlsConfig?.rejectUnauthorized ?? rejectUnauthorized ?? '')}`,
        `servername=${tlsConfig?.servername ?? ''}`,
        `ca=${stableToken(tlsConfig?.ca)}`,
        `cert=${stableToken(tlsConfig?.cert)}`,
        `key=${stableToken(tlsConfig?.key)}`,
        `pfx=${stableToken(tlsConfig?.pfx)}`,
        `passphrase=${tlsConfig?.passphrase === undefined ? '' : 'set'}`,
        `lookup=${lookup ? objectId(lookup) : ''}`,
    ].join('|');
}

function stableToken(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array) {
        return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
    }
    if (Array.isArray(value)) return value.map(stableToken).join(',');
    if (typeof value === 'function') return `fn-${objectId(value)}`;
    if (typeof value === 'object' && value !== null) return `obj-${objectId(value)}`;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol') return String(value);
    return '';
}

function objectId(value: object): number {
    const existing = objectIds.get(value);
    if (existing) return existing;
    const id = nextObjectId;
    nextObjectId += 1;
    objectIds.set(value, id);
    return id;
}

function positiveInteger(value: number | undefined): number | undefined {
    return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function toTransferBuffer(chunk: unknown): Buffer {
    if (Buffer.isBuffer(chunk)) return chunk;
    if (typeof chunk === 'string') return Buffer.from(chunk);
    if (chunk instanceof Uint8Array) return Buffer.from(chunk);
    return Buffer.from(String(chunk));
}

function normalizeTransportError(error: unknown, config: RuntimeRequestConfig): Error {
    const normalized = normalizeError(error);
    return normalized instanceof NeutrxError ? normalized : NeutrxErrorFactory.fromNodeError(normalized, config);
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
}
