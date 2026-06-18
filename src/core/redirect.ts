import { NeutrxHeaders } from './headers.js';
import type { Headers, HttpMethod, InternalHeaders, InternalRequestConfig, RedirectContext } from '../types.js';

export const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const REDIRECT_SENSITIVE_HEADER_RE = /(?:^|[-_])(authorization|cookie|proxy-authorization|token|access-token|refresh-token|secret|password|passwd|api-key|apikey|client-secret)(?:$|[-_])/i;

export function shouldRedirectWithGet(statusCode: number, method: HttpMethod): boolean {
    if (statusCode === 303 && method !== 'HEAD') return true;
    return (statusCode === 301 || statusCode === 302) && method === 'POST';
}

export function stripRedirectHeaders(
    headers: Headers | NeutrxHeaders,
    fromURL: string,
    toURL: string,
    bodyDropped: boolean,
    sensitiveHeaders?: readonly string[]
): InternalHeaders {
    const from = new URL(fromURL);
    const to = new URL(toURL);
    const crossOrigin = from.origin !== to.origin;
    const protocolDowngrade = from.protocol === 'https:' && to.protocol === 'http:';
    const stripped = new Set(['authorization', 'cookie', 'proxy-authorization']);
    if (sensitiveHeaders) for (const name of sensitiveHeaders) stripped.add(name.toLowerCase());

    if (crossOrigin) stripped.add('host');
    if (bodyDropped) {
        stripped.add('content-type');
        stripped.add('content-length');
        stripped.add('transfer-encoding');
    }

    const next = new NeutrxHeaders();
    for (const [key, value] of Object.entries(NeutrxHeaders.from(headers).toJSON({ includeBlocked: true }))) {
        const normalized = key.toLowerCase();
        if ((crossOrigin || protocolDowngrade) && REDIRECT_SENSITIVE_HEADER_RE.test(normalized)) continue;
        if ((crossOrigin || protocolDowngrade) && stripped.has(normalized)) continue;
        if (bodyDropped && stripped.has(normalized)) continue;
        next.set(key, value);
    }
    return next as unknown as InternalHeaders;
}

export function withoutBody(config: InternalRequestConfig): InternalRequestConfig {
    const entries = Object.entries(config).filter(([key]) => key !== 'data');
    return Object.fromEntries(entries) as InternalRequestConfig;
}

export function buildRedirectContext(statusCode: number, location: string, fromURL: string, toURL: string, headers: Headers): RedirectContext {
    return { statusCode, location, fromURL, toURL, headers };
}
