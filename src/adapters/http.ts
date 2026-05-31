import http, { type Agent as HttpAgent, type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import https, { type Agent as HttpsAgent } from 'node:https';
import { Readable } from 'node:stream';
import type { Duplex } from 'node:stream';
import type { PeerCertificate } from 'node:tls';

import type SecurityManager from '../security/SecurityManager.js';
import { abortError } from '../core/cancel.js';
import { serializeBody } from '../core/bodySerializer.js';
import {
    NeutrxConnectTimeoutError,
    NeutrxError,
    NeutrxErrorFactory,
    NeutrxRequestSizeError,
    NeutrxResponseSizeError,
    NeutrxSecurityError,
    NeutrxResponseTimeoutError,
    axiosTimeoutErrorCode,
} from '../core/NeutrxError.js';
import { createLookup, validateProxyTarget } from '../core/dns.js';
import { NeutrxHeaders, getContentLength, hasHeader, normalizeIncomingHeaders, setHeader, toOutgoingHeaders } from '../core/headers.js';
import { attachStreamDownloadProgress, reportDownloadProgress, reportUploadProgress } from '../core/progress.js';
import { createHttpsProxyConnection, directRequestTarget, proxyRequestTarget, resolveProxy } from '../core/proxy.js';
import type { InternalHeaders, InternalRequestConfig, MaxRate, NormalizedClientConfig, RawHttpResponse, RequestAdapter } from '../types.js';

export const NODE_HTTP_SECURE_CIPHERS = [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256',
].join(':');

export interface NodeHttpAdapterAgents {
    readonly http: HttpAgent;
    readonly https: HttpsAgent;
}

export interface NodeHttpAdapterOptions {
    readonly security: SecurityManager;
    readonly defaults: Pick<NormalizedClientConfig, 'httpAgent' | 'httpsAgent' | 'lookup' | 'proxy' | 'security' | 'tls'>;
    readonly agents: NodeHttpAdapterAgents;
}

type RuntimeRequestConfig = InternalRequestConfig & { headers: InternalHeaders };
const RATE_SLICE_INTERVAL_MS = 100;

export function createNodeHttpAgents(): NodeHttpAdapterAgents {
    const options = { keepAlive: true, keepAliveMsecs: 1000, maxSockets: 50, maxFreeSockets: 10 };
    return {
        http: new http.Agent(options),
        https: new https.Agent({ ...options, minVersion: 'TLSv1.2', ciphers: NODE_HTTP_SECURE_CIPHERS }),
    };
}

export function createNodeHttpAdapter(options: NodeHttpAdapterOptions): RequestAdapter {
    return config => nodeHttpAdapter(config, options);
}

export async function nodeHttpAdapter(config: InternalRequestConfig, options: NodeHttpAdapterOptions): Promise<RawHttpResponse> {
    const runtimeConfig: RuntimeRequestConfig = { ...config, headers: NeutrxHeaders.from(config.headers) as unknown as InternalHeaders };
    const url = new URL(runtimeConfig.url);
    if (runtimeConfig.tls?.certificatePins) options.security.setCertificatePins(runtimeConfig.tls.certificatePins);
    const body = runtimeConfig.data === undefined ? null : await serializeBody(runtimeConfig);
    if (body !== null && !(body instanceof Readable) && !hasHeader(runtimeConfig.headers, 'Content-Length')) {
        setHeader(runtimeConfig.headers, 'Content-Length', Buffer.byteLength(body));
    }

    const proxy = resolveProxy(runtimeConfig.proxy ?? options.defaults.proxy, url);
    if (runtimeConfig.socketPath && proxy) {
        throw new NeutrxSecurityError('socketPath cannot be combined with proxy', { code: 'SOCKET_PROXY_CONFLICT' });
    }
    if (proxy) await validateProxyTarget(url, runtimeConfig, options.security);
    const requestTarget = proxy ? proxyRequestTarget(url, runtimeConfig.headers, proxy) : directRequestTarget(url, runtimeConfig.headers);
    if (runtimeConfig.socketPath && !hasHeader(requestTarget.headers, 'Host')) {
        setHeader(requestTarget.headers, 'Host', requestTarget.url.host);
    }
    for (const [key, value] of Object.entries(requestTarget.headers)) {
        options.security.validateHeader(key, value);
    }
    const lookup = runtimeConfig.socketPath
        ? undefined
        : await createLookup(requestTarget.url, runtimeConfig, options.security, options.defaults.lookup, requestTarget.isProxied && !requestTarget.tunnel);

    return new Promise((resolve, reject) => {
        const isHTTPS = requestTarget.url.protocol === 'https:';
        const maxSize = runtimeConfig.maxContentLength;
        const rate = parseMaxRate(runtimeConfig.maxRate);
        const tlsConfig = runtimeConfig.tls ?? options.defaults.tls;
        let settled = false;
        const fail = (error: Error): void => {
            if (settled) return;
            settled = true;
            reject(error);
        };

        if (runtimeConfig.socketPath && isHTTPS) {
            fail(new NeutrxSecurityError('socketPath supports HTTP only', { code: 'SOCKET_HTTPS_UNSUPPORTED' }));
            return;
        }

        if (runtimeConfig.signal?.aborted) {
            fail(abortError(runtimeConfig.signal));
            return;
        }

        const requestOptions: RequestOptions = {
            path: requestTarget.path,
            method: runtimeConfig.method,
            headers: toOutgoingHeaders(requestTarget.headers),
            ...(runtimeConfig.socketPath
                ? { socketPath: runtimeConfig.socketPath }
                : {
                    hostname: requestTarget.url.hostname,
                    port: requestTarget.url.port || (isHTTPS ? 443 : 80),
                    agent: requestTarget.tunnel
                        ? false
                        : isHTTPS
                        ? runtimeConfig.httpsAgent ?? options.defaults.httpsAgent ?? options.agents.https
                        : runtimeConfig.httpAgent ?? options.defaults.httpAgent ?? options.agents.http,
                }),
            ...(lookup ? { lookup } : {}),
            ...(requestTarget.tunnel
                ? {
                    createConnection: (_requestOptions: RequestOptions, callback: (error: Error | null, socket: Duplex) => void): Duplex | null | undefined => createHttpsProxyConnection(
                        requestTarget.tunnel!,
                        runtimeConfig.connectTimeout,
                        options.defaults.security.validateCertificate,
                        callback
                    ),
                }
                : {}),
            ...(isHTTPS
                ? {
                    rejectUnauthorized: tlsConfig?.rejectUnauthorized ?? options.defaults.security.validateCertificate,
                    minVersion: 'TLSv1.2',
                    ciphers: NODE_HTTP_SECURE_CIPHERS,
                    ...(tlsConfig?.ca !== undefined ? { ca: tlsConfig.ca } : {}),
                    ...(tlsConfig?.cert !== undefined ? { cert: tlsConfig.cert } : {}),
                    ...(tlsConfig?.key !== undefined ? { key: tlsConfig.key } : {}),
                    ...(tlsConfig?.pfx !== undefined ? { pfx: tlsConfig.pfx } : {}),
                    ...(tlsConfig?.passphrase !== undefined ? { passphrase: tlsConfig.passphrase } : {}),
                    ...(tlsConfig?.servername !== undefined ? { servername: tlsConfig.servername } : {}),
                    checkServerIdentity: (host: string, cert: PeerCertificate): Error | undefined => options.security.checkServerIdentity(host, cert),
                }
                : {}),
        };

        const transport = isHTTPS ? https : http;
        const req = transport.request(requestOptions, response => {
            void handleNodeHttpResponse(response, runtimeConfig, maxSize, req, rate.download).then(result => {
                if (settled) return;
                settled = true;
                resolve(result);
            }, fail);
        });

        const connectTimer = setTimeout(() => {
            req.destroy();
            fail(new NeutrxConnectTimeoutError(runtimeConfig.url, runtimeConfig.connectTimeout, {
                code: axiosTimeoutErrorCode(runtimeConfig.transitional),
            }));
        }, runtimeConfig.connectTimeout);

        req.on('socket', socket => {
            clearTimeout(connectTimer);
            const onTimeout = (): void => {
                req.destroy();
                fail(new NeutrxResponseTimeoutError(runtimeConfig.url, runtimeConfig.timeout, {
                    code: axiosTimeoutErrorCode(runtimeConfig.transitional),
                }));
            };
            socket.setTimeout(runtimeConfig.timeout);
            socket.once('timeout', onTimeout);
            req.once('close', () => {
                socket.off('timeout', onTimeout);
            });
        });

        req.on('error', error => {
            clearTimeout(connectTimer);
            const normalized = normalizeError(error);
            fail(normalized instanceof NeutrxError ? normalized : NeutrxErrorFactory.fromNodeError(normalized, runtimeConfig));
        });

        runtimeConfig.signal?.addEventListener('abort', () => {
            req.destroy();
            fail(abortError(runtimeConfig.signal));
        }, { once: true });

        if (runtimeConfig.data !== undefined) {
            if (body instanceof Readable) {
                writeStreamBody(req, body, runtimeConfig, fail, rate.upload);
                return;
            }

            if (body !== null) {
                const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
                const total = payload.length;
                if (total > runtimeConfig.maxBodyLength) {
                    req.destroy();
                    fail(new NeutrxRequestSizeError(total, runtimeConfig.maxBodyLength));
                    return;
                }
                writeBufferBody(req, payload, runtimeConfig, total, fail, rate.upload);
                return;
            }
        }

        req.end();
    });
}

async function handleNodeHttpResponse(
    response: IncomingMessage,
    config: InternalRequestConfig,
    maxSize: number,
    request: ClientRequest,
    downloadRate?: number
): Promise<RawHttpResponse> {
    const rawHeaders = normalizeIncomingHeaders(response.headers);
    const status = response.statusCode ?? 0;
    const statusText = response.statusMessage ?? '';

    if (config.responseType === 'stream') {
        if (downloadRate) {
            return { status, statusText, headers: rawHeaders, data: createThrottledDownloadStream(response, config, downloadRate), config, request };
        }
        attachStreamDownloadProgress(response, config);
        const data = response;
        return { status, statusText, headers: rawHeaders, data, config, request };
    }

    const chunks: Buffer[] = [];
    let received = 0;
    const downloadStartedAt = Date.now();
    const total = getContentLength(rawHeaders);
    reportDownloadProgress(config, received, total);

    try {
        for await (const chunk of response) {
            const buffer = toTransferBuffer(chunk);
            for (const slice of transferSlices(buffer, downloadRate)) {
                const nextReceived = received + slice.length;
                if (nextReceived > maxSize) {
                    response.destroy();
                    throw new NeutrxResponseSizeError(nextReceived, maxSize);
                }
                await waitForThrottle(nextReceived, downloadRate, downloadStartedAt);
                chunks.push(slice);
                received = nextReceived;
                reportDownloadProgress(config, received, total);
            }
        }
    } catch (error: unknown) {
        throw normalizeError(error);
    }

    return { status, statusText, headers: rawHeaders, data: Buffer.concat(chunks), config, request };
}

function writeBufferBody(
    req: ClientRequest,
    body: Buffer,
    config: InternalRequestConfig,
    total: number,
    fail: (error: Error) => void,
    uploadRate?: number
): void {
    const startedAt = Date.now();
    let offset = 0;
    reportUploadProgress(config, offset, total);

    void (async () => {
        for (const chunk of transferSlices(body, uploadRate)) {
            const nextLoaded = offset + chunk.length;
            await waitForThrottle(nextLoaded, uploadRate, startedAt);
            await writeRequestChunk(req, chunk);
            offset = nextLoaded;
            reportUploadProgress(config, offset, total);
        }
        req.end();
    })().catch(error => {
        req.destroy();
        fail(normalizeError(error));
    });
}

function writeStreamBody(req: ClientRequest, body: Readable, config: InternalRequestConfig, fail: (error: Error) => void, uploadRate?: number): void {
    const total = getContentLength(config.headers);
    let loaded = 0;
    const startedAt = Date.now();

    if (total !== undefined && total > config.maxBodyLength) {
        req.destroy();
        fail(new NeutrxRequestSizeError(total, config.maxBodyLength));
        return;
    }

    reportUploadProgress(config, loaded, total);

    void (async () => {
        for await (const chunk of body) {
            const buffer = toTransferBuffer(chunk);
            for (const slice of transferSlices(buffer, uploadRate)) {
                const nextLoaded = loaded + slice.length;
                if (nextLoaded > config.maxBodyLength) {
                    throw new NeutrxRequestSizeError(nextLoaded, config.maxBodyLength);
                }
                await waitForThrottle(nextLoaded, uploadRate, startedAt);
                await writeRequestChunk(req, slice);
                loaded = nextLoaded;
                reportUploadProgress(config, loaded, total);
            }
        }
        req.end();
    })().catch(error => {
        req.destroy();
        fail(normalizeError(error));
    });
}

function createThrottledDownloadStream(response: IncomingMessage, config: InternalRequestConfig, downloadRate: number): Readable {
    const total = getContentLength(normalizeIncomingHeaders(response.headers));
    const startedAt = Date.now();
    let loaded = 0;
    reportDownloadProgress(config, loaded, total);

    return Readable.from((async function* throttledDownload(): AsyncGenerator<Buffer> {
        for await (const chunk of response) {
            const buffer = toTransferBuffer(chunk);
            for (const slice of transferSlices(buffer, downloadRate)) {
                const nextLoaded = loaded + slice.length;
                await waitForThrottle(nextLoaded, downloadRate, startedAt);
                loaded = nextLoaded;
                reportDownloadProgress(config, loaded, total);
                yield slice;
            }
        }
    })());
}

function parseMaxRate(maxRate: MaxRate | undefined): { readonly upload?: number; readonly download?: number } {
    if (maxRate === undefined) return {};
    const sameRate = typeof maxRate === 'number' ? positiveRate(maxRate) : undefined;
    if (sameRate !== undefined) return { upload: sameRate, download: sameRate };
    if (typeof maxRate === 'number') return {};
    const [upload, download] = maxRate;
    return {
        ...(positiveRate(upload) !== undefined ? { upload } : {}),
        ...(positiveRate(download) !== undefined ? { download } : {}),
    };
}

function positiveRate(value: number | undefined): number | undefined {
    return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function transferSlices(buffer: Buffer, rate?: number): readonly Buffer[] {
    if (!rate || buffer.length === 0) return [buffer];
    const chunkSize = Math.max(1, Math.floor(rate / (1000 / RATE_SLICE_INTERVAL_MS)));
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        chunks.push(buffer.subarray(offset, Math.min(buffer.length, offset + chunkSize)));
    }
    return chunks;
}

async function waitForThrottle(loaded: number, rate: number | undefined, startedAt: number): Promise<void> {
    const delayMs = throttleDelay(loaded, rate, startedAt);
    if (delayMs <= 0) return;
    await new Promise<void>(resolve => {
        setTimeout(resolve, delayMs);
    });
}

function writeRequestChunk(req: ClientRequest, chunk: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        req.write(chunk, error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function throttleDelay(loaded: number, rate: number | undefined, startedAt: number): number {
    if (!rate) return 0;
    const expectedElapsed = (loaded / rate) * 1000;
    return Math.max(0, expectedElapsed - (Date.now() - startedAt));
}

function toTransferBuffer(chunk: unknown): Buffer {
    if (Buffer.isBuffer(chunk)) return chunk;
    if (typeof chunk === 'string') return Buffer.from(chunk);
    if (chunk instanceof Uint8Array) return Buffer.from(chunk);
    return Buffer.from(String(chunk));
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
}
