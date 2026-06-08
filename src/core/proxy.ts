import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import { NeutrxSecurityError } from './NeutrxError.js';
import { NeutrxHeaders, hasHeader, toOutgoingHeaders } from './headers.js';
import type { Headers, InternalHeaders, ProxyConfig } from '../types.js';

export type NormalizedProxyConfig = Required<Pick<ProxyConfig, 'protocol' | 'host'>> & Pick<ProxyConfig, 'port' | 'auth' | 'headers'>;
export type RequestTarget =
    | { readonly url: URL; readonly path: string; readonly headers: InternalHeaders; readonly isProxied: false; readonly tunnel?: undefined }
    | { readonly url: URL; readonly path: string; readonly headers: InternalHeaders; readonly isProxied: true; readonly tunnel?: HttpsProxyTunnel };

export type HttpsProxyTunnel = {
    readonly proxy: NormalizedProxyConfig;
    readonly target: URL;
};

export function resolveProxy(configProxy: ProxyConfig | false | undefined, target: URL, env: NodeJS.ProcessEnv = process.env): NormalizedProxyConfig | undefined {
    if (configProxy === false) return undefined;
    if (configProxy) return normalizeProxy(configProxy);
    if (matchesNoProxy(target.hostname, target.port, env.NO_PROXY ?? env.no_proxy)) return undefined;

    const raw = target.protocol === 'https:'
        ? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy
        : env.HTTP_PROXY ?? env.http_proxy;
    return raw ? proxyFromURL(raw) : undefined;
}

export function directRequestTarget(targetURL: URL, headers: Headers | NeutrxHeaders): RequestTarget {
    return {
        url: targetURL,
        path: `${targetURL.pathname}${targetURL.search}`,
        headers: NeutrxHeaders.from(headers) as unknown as InternalHeaders,
        isProxied: false,
    };
}

export function proxyRequestTarget(targetURL: URL, requestHeaders: Headers | NeutrxHeaders, proxy: NormalizedProxyConfig): RequestTarget {
    const normalizedRequestHeaders = NeutrxHeaders.from(requestHeaders);
    if (targetURL.protocol === 'https:') {
        return {
            url: targetURL,
            path: `${targetURL.pathname}${targetURL.search}`,
            headers: normalizedRequestHeaders as unknown as InternalHeaders,
            isProxied: true,
            tunnel: { proxy, target: targetURL },
        };
    }

    const proxyURL = new URL(`${proxy.protocol}://${proxy.host}`);
    if (proxy.port !== undefined) proxyURL.port = String(proxy.port);

    const headers = NeutrxHeaders.from(proxy.headers);
    if (proxy.auth !== undefined) headers.setIfNotBlocked('Proxy-Authorization', proxyAuthHeader(proxy.auth));
    if (!hasHeader(requestHeaders, 'Host') && !headers.has('Host')) headers.set('Host', targetURL.host);

    return {
        url: proxyURL,
        path: targetURL.href,
        headers: NeutrxHeaders.concat(normalizedRequestHeaders, headers) as unknown as InternalHeaders,
        isProxied: true,
    };
}

export function createConnectTunnel(tunnel: HttpsProxyTunnel, timeout: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
        const proxyPort = tunnel.proxy.port ?? (tunnel.proxy.protocol === 'https' ? 443 : 80);
        const socket = net.connect(proxyPort, tunnel.proxy.host);
        const cleanup = (): void => {
            socket.removeAllListeners('connect');
            socket.removeAllListeners('timeout');
            socket.removeAllListeners('error');
            socket.removeAllListeners('data');
        };

        socket.setTimeout(timeout);
        socket.on('connect', () => {
            const headers = NeutrxHeaders.concat({ Host: tunnel.target.host }, tunnel.proxy.headers);
            if (tunnel.proxy.auth !== undefined) headers.setIfNotBlocked('Proxy-Authorization', proxyAuthHeader(tunnel.proxy.auth));

            const request = [
                `CONNECT ${tunnel.target.hostname}:${tunnel.target.port || 443} HTTP/1.1`,
                ...Object.entries(toOutgoingHeaders(headers)).map(([key, value]) => `${key}: ${String(value)}`),
                '',
                '',
            ].join('\r\n');
            socket.write(request);
        });

        let buffered = Buffer.alloc(0);
        socket.on('data', chunk => {
            buffered = Buffer.concat([buffered, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
            const headerEnd = buffered.indexOf('\r\n\r\n');
            if (headerEnd === -1) return;

            const head = buffered.subarray(0, headerEnd).toString('latin1');
            const status = /^HTTP\/1\.[01] (\d{3})/i.exec(head)?.[1];
            if (status !== '200') {
                cleanup();
                socket.destroy();
                reject(new NeutrxSecurityError(`Proxy CONNECT failed with status ${status ?? 'unknown'}`, { code: 'PROXY_CONNECT_FAILED' }));
                return;
            }

            const rest = buffered.subarray(headerEnd + 4);
            cleanup();
            if (rest.length > 0) socket.unshift(rest);
            resolve(socket);
        });
        socket.on('timeout', () => {
            cleanup();
            socket.destroy();
            reject(new NeutrxSecurityError('Proxy CONNECT timeout', { code: 'PROXY_CONNECT_TIMEOUT' }));
        });
        socket.on('error', error => {
            cleanup();
            reject(error);
        });
    });
}

export function createHttpsProxyConnection(
    tunnel: HttpsProxyTunnel,
    timeout: number,
    rejectUnauthorized: boolean,
    callback: (error: Error | null, socket: Duplex) => void
): Socket {
    const placeholder = new net.Socket();
    void createConnectTunnel(tunnel, timeout).then(socket => {
        const tlsSocket = tls.connect({
            socket,
            servername: tunnel.target.hostname,
            rejectUnauthorized,
        }, () => callback(null, tlsSocket));
        tlsSocket.on('error', (error: Error) => callback(error, tlsSocket));
    }, error => callback(error instanceof Error ? error : new Error(String(error)), placeholder));
    return placeholder;
}

export function proxyAuthHeader(auth: NonNullable<ProxyConfig['auth']>): string {
    if (typeof auth === 'string') return auth;
    return `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
}

export function stripProxyAuthorization(headers: Headers): Headers {
    const next: Headers = {};
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'proxy-authorization') continue;
        next[key] = value;
    }
    return next;
}

export function matchesNoProxy(host: string, port: string, value?: string): boolean {
    if (!value) return false;
    const normalizedHost = host.toLowerCase();
    const hostPort = port ? `${normalizedHost}:${port}` : normalizedHost;

    return value.split(',').map(item => item.trim().toLowerCase()).some(entry => {
        if (!entry) return false;
        if (entry === '*') return true;
        if (entry === normalizedHost || entry === hostPort) return true;
        if (entry.startsWith('.')) return normalizedHost === entry.slice(1) || normalizedHost.endsWith(entry);
        return normalizedHost.endsWith(`.${entry}`);
    });
}

function normalizeProxy(proxy: ProxyConfig): NormalizedProxyConfig {
    const rawProtocol: unknown = proxy.protocol ?? 'http';
    if (rawProtocol !== 'http' && rawProtocol !== 'https') {
        throw new NeutrxSecurityError(`Unsupported proxy protocol: ${String(rawProtocol)}`, { code: 'UNSUPPORTED_PROXY_PROTOCOL' });
    }
    return {
        protocol: rawProtocol,
        host: proxy.host,
        ...(proxy.port !== undefined ? { port: proxy.port } : {}),
        ...(proxy.auth !== undefined ? { auth: proxy.auth } : {}),
        ...(proxy.headers ? { headers: proxy.headers } : {}),
    };
}

function proxyFromURL(value: string): NormalizedProxyConfig {
    const parsed = new URL(value.includes('://') ? value : `http://${value}`);
    const auth = parsed.username
        ? { username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) }
        : undefined;
    return normalizeProxy({
        protocol: parsed.protocol === 'https:' ? 'https' : 'http',
        host: parsed.hostname,
        ...(parsed.port ? { port: Number.parseInt(parsed.port, 10) } : {}),
        ...(auth ? { auth } : {}),
    });
}

void http;
