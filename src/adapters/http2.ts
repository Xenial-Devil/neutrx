import http2 from 'node:http2';
import { Readable } from 'node:stream';

import { NeutrxResponseSizeError, NeutrxResponseTimeoutError } from '../core/NeutrxError.js';
import { serializeBody } from '../core/bodySerializer.js';
import { getContentLength, hasHeader, normalizeIncomingHeaders, setHeader } from '../core/headers.js';
import { reportDownloadProgress, reportUploadProgress, toUploadBuffer } from '../core/progress.js';
import type { Headers, Http2SessionStats, RawHttpResponse, RequestAdapter } from '../types.js';

interface SessionRecord {
    readonly session: http2.ClientHttp2Session;
    activeStreams: number;
}

const sessions = new Map<string, SessionRecord>();

export const http2Adapter: RequestAdapter = async config => {
    const url = new URL(config.url);
    if (config.proxy) {
        throw new Error('HTTP/2 adapter does not support proxy tunneling; use HTTP/1.1 for proxied requests');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`HTTP/2 adapter cannot handle protocol ${url.protocol}`);
    }

    const runtimeHeaders: Headers = { ...config.headers };
    const body = config.data === undefined ? null : await serializeBody({ ...config, headers: runtimeHeaders });
    if (body !== null && !(body instanceof Readable) && !hasHeader(runtimeHeaders, 'Content-Length')) {
        setHeader(runtimeHeaders, 'Content-Length', Buffer.byteLength(body));
    }

    const origin = url.origin;
    const record = getSession(origin, config.http2Options);
    const session = record.session;
    const streamLimit = streamLimitFor(record, config.http2Options?.maxConcurrentStreams);
    if (record.activeStreams >= streamLimit) {
        throw Object.assign(new Error(`HTTP/2 max concurrent streams reached for ${origin}: ${streamLimit}`), { code: 'HTTP2_MAX_CONCURRENT_STREAMS' });
    }
    const headers: http2.OutgoingHttpHeaders = {
        ':method': config.method,
        ':path': `${url.pathname}${url.search}`,
        ':scheme': url.protocol.slice(0, -1),
        ':authority': url.host,
        ...toHttp2Headers(runtimeHeaders),
    };

    return new Promise((resolve, reject) => {
        const request = session.request(headers);
        record.activeStreams += 1;
        const chunks: Buffer[] = [];
        let received = 0;
        let responseHeaders: http2.IncomingHttpHeaders = {};
        let status = 0;
        let settled = false;

        const fail = (error: Error): void => {
            if (settled) return;
            settled = true;
            request.close();
            reject(error);
        };

        const timeout = setTimeout(() => fail(new NeutrxResponseTimeoutError(config.url, config.timeout)), config.timeout);
        request.once('close', () => {
            record.activeStreams = Math.max(0, record.activeStreams - 1);
        });

        request.on('response', headersMap => {
            responseHeaders = headersMap;
            const rawStatus = headersMap[':status'];
            status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus ?? 0);
            reportDownloadProgress(config, 0, getContentLength(normalizeHttp2Headers(headersMap)));
        });

        request.on('data', chunk => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            received += buffer.length;
            if (received > config.maxContentLength) {
                fail(new NeutrxResponseSizeError(received, config.maxContentLength));
                return;
            }
            chunks.push(buffer);
            reportDownloadProgress(config, received, getContentLength(normalizeHttp2Headers(responseHeaders)));
        });

        request.on('end', () => {
            if (settled) return;
            clearTimeout(timeout);
            settled = true;
            resolve({
                status,
                statusText: String(status),
                headers: normalizeHttp2Headers(responseHeaders),
                data: Buffer.concat(chunks),
                config: { ...config, headers: runtimeHeaders },
            } satisfies RawHttpResponse);
        });

        request.on('error', (error: Error) => {
            clearTimeout(timeout);
            fail(error);
        });

        config.signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            fail(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
        }, { once: true });

        if (body instanceof Readable) {
            writeStream(request, body, config.maxBodyLength, loaded => reportUploadProgress(config, loaded));
            return;
        }
        if (body !== null) {
            const length = Buffer.byteLength(body);
            if (length > config.maxBodyLength) {
                fail(new Error(`Request body too large: ${length} > ${config.maxBodyLength}`));
                return;
            }
            request.end(body, () => reportUploadProgress(config, length, length));
            return;
        }
        request.end();
    });
};

export function closeHttp2Sessions(): void {
    for (const record of sessions.values()) record.session.close();
    sessions.clear();
}

export function getHttp2SessionStats(): Http2SessionStats {
    const origins: Http2SessionStats['origins'] = {};
    for (const [origin, record] of sessions) {
        origins[origin] = {
            activeStreams: record.activeStreams,
            closed: record.session.closed,
            destroyed: record.session.destroyed,
            ...(record.session.remoteSettings.maxConcurrentStreams !== undefined
                ? { remoteMaxConcurrentStreams: record.session.remoteSettings.maxConcurrentStreams }
                : {}),
        };
    }
    return { sessions: sessions.size, origins };
}

function getSession(origin: string, options: Parameters<RequestAdapter>[0]['http2Options']): SessionRecord {
    const existing = sessions.get(origin);
    if (existing && !existing.session.closed && !existing.session.destroyed) return existing;

    if (options?.maxSessions !== undefined && sessions.size >= options.maxSessions) {
        const first = sessions.keys().next().value;
        if (first) {
            sessions.get(first)?.session.close();
            sessions.delete(first);
        }
    }

    const session = http2.connect(origin, {
        rejectUnauthorized: options?.rejectUnauthorized,
    });
    if (options?.sessionTimeout !== undefined) {
        session.setTimeout(options.sessionTimeout, () => {
            session.close();
            sessions.delete(origin);
        });
    }
    session.on('close', () => sessions.delete(origin));
    session.on('error', () => sessions.delete(origin));
    session.on('goaway', () => {
        session.close();
        sessions.delete(origin);
    });
    const record: SessionRecord = { session, activeStreams: 0 };
    sessions.set(origin, record);
    return record;
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
        if (forbidden.has(lower)) continue;
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

function writeStream(
    request: http2.ClientHttp2Stream,
    stream: Readable,
    maxBodyLength: number,
    onProgress: (loaded: number) => void
): void {
    let loaded = 0;
    onProgress(loaded);
    stream.on('data', chunk => {
        stream.pause();
        const buffer = toUploadBuffer(chunk);
        loaded += buffer.length;
        if (loaded > maxBodyLength) {
            request.destroy(new Error(`Request body too large: ${loaded} > ${maxBodyLength}`));
            return;
        }
        request.write(buffer, () => {
            onProgress(loaded);
            stream.resume();
        });
    });
    stream.on('end', () => request.end());
    stream.on('error', error => request.destroy(error));
}
