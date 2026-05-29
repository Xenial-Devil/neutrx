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
import { attachStreamDownloadProgress, reportDownloadProgress, reportUploadProgress, toUploadBuffer } from '../core/progress.js';
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
                writeBufferBody(req, payload, runtimeConfig, total, rate.upload);
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
        throttleReadable(response, downloadRate);
        attachStreamDownloadProgress(response, config);
        return { status, statusText, headers: rawHeaders, data: response, config, request };
    }

    const chunks: Buffer[] = [];
    let received = 0;
    const downloadStartedAt = Date.now();

    return new Promise((resolve, reject) => {
        const total = getContentLength(rawHeaders);
        reportDownloadProgress(config, received, total);

        response.on('data', chunk => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            received += buffer.length;
            if (received > maxSize) {
                response.destroy();
                reject(new NeutrxResponseSizeError(received, maxSize));
                return;
            }
            chunks.push(buffer);
            reportDownloadProgress(config, received, total);
            throttleReadable(response, downloadRate, throttleDelay(received, downloadRate, downloadStartedAt));
        });

        response.on('end', () => {
            resolve({ status, statusText, headers: rawHeaders, data: Buffer.concat(chunks), config, request });
        });
        response.on('error', error => reject(normalizeError(error)));
    });
}

function writeBufferBody(req: ClientRequest, body: Buffer, config: InternalRequestConfig, total: number, uploadRate?: number): void {
    if (!uploadRate) {
        reportUploadProgress(config, 0, total);
        req.write(body, () => {
            reportUploadProgress(config, total, total);
            req.end();
        });
        return;
    }

    const startedAt = Date.now();
    const chunkSize = Math.max(1, Math.floor(uploadRate / 10));
    let offset = 0;
    reportUploadProgress(config, offset, total);

    const writeNext = (): void => {
        if (offset >= body.length) {
            req.end();
            return;
        }
        const end = Math.min(body.length, offset + chunkSize);
        const chunk = body.subarray(offset, end);
        const nextLoaded = end;
        const delay = throttleDelay(nextLoaded, uploadRate, startedAt);
        setTimeout(() => {
            req.write(chunk, () => {
                offset = nextLoaded;
                reportUploadProgress(config, offset, total);
                writeNext();
            });
        }, delay);
    };

    writeNext();
}

function writeStreamBody(req: ClientRequest, body: Readable, config: InternalRequestConfig, fail: (error: Error) => void, uploadRate?: number): void {
    const total = getContentLength(config.headers);
    let loaded = 0;
    const startedAt = Date.now();
    let ended = false;
    let pendingWrites = 0;

    if (total !== undefined && total > config.maxBodyLength) {
        req.destroy();
        fail(new NeutrxRequestSizeError(total, config.maxBodyLength));
        return;
    }

    reportUploadProgress(config, loaded, total);

    body.on('data', (chunk: unknown) => {
        body.pause();
        const buffer = toUploadBuffer(chunk);
        if (loaded + buffer.length > config.maxBodyLength) {
            req.destroy();
            fail(new NeutrxRequestSizeError(loaded + buffer.length, config.maxBodyLength));
            return;
        }
        const nextLoaded = loaded + buffer.length;
        const delay = throttleDelay(nextLoaded, uploadRate, startedAt);
        const write = (): void => {
            pendingWrites += 1;
            req.write(buffer, () => {
                pendingWrites -= 1;
                loaded = nextLoaded;
                reportUploadProgress(config, loaded, total);
                if (ended && pendingWrites === 0) {
                    req.end();
                    return;
                }
                body.resume();
            });
        };
        if (delay > 0) {
            setTimeout(write, delay);
        } else {
            write();
        }
    });

    body.on('end', () => {
        ended = true;
        if (pendingWrites === 0) req.end();
    });

    body.on('error', error => {
        req.destroy();
        fail(normalizeError(error));
    });
}

function parseMaxRate(maxRate: MaxRate | undefined): { readonly upload?: number; readonly download?: number } {
    if (maxRate === undefined) return {};
    if (typeof maxRate === 'number') return positiveRate(maxRate) === undefined ? {} : { upload: maxRate, download: maxRate };
    const [upload, download] = maxRate;
    return {
        ...(positiveRate(upload) !== undefined ? { upload } : {}),
        ...(positiveRate(download) !== undefined ? { download } : {}),
    };
}

function positiveRate(value: number | undefined): number | undefined {
    return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function throttleDelay(loaded: number, rate: number | undefined, startedAt: number): number {
    if (!rate) return 0;
    const expectedElapsed = (loaded / rate) * 1000;
    return Math.max(0, expectedElapsed - (Date.now() - startedAt));
}

function throttleReadable(stream: Readable, rate: number | undefined, delay?: number): void {
    const wait = delay ?? 0;
    if (!rate || wait <= 0) return;
    stream.pause();
    setTimeout(() => stream.resume(), wait);
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
}
