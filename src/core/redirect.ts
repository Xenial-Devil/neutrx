import type { Headers, HttpMethod, InternalRequestConfig, RedirectContext } from '../types.js';

export const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const REDIRECT_SENSITIVE_HEADER_RE = /(?:^|[-_])(authorization|cookie|proxy-authorization|token|access-token|refresh-token|secret|password|passwd|api-key|apikey|client-secret)(?:$|[-_])/i;

export function shouldRedirectWithGet(statusCode: number, method: HttpMethod): boolean {
    if (statusCode === 303 && method !== 'HEAD') return true;
    return (statusCode === 301 || statusCode === 302) && method === 'POST';
}

export function stripRedirectHeaders(headers: Headers, fromURL: string, toURL: string, bodyDropped: boolean): Headers {
    const from = new URL(fromURL);
    const to = new URL(toURL);
    const crossOrigin = from.origin !== to.origin;
    const protocolDowngrade = from.protocol === 'https:' && to.protocol === 'http:';
    const stripped = new Set(['authorization', 'cookie', 'proxy-authorization']);

    if (crossOrigin) stripped.add('host');
    if (bodyDropped) {
        stripped.add('content-type');
        stripped.add('content-length');
        stripped.add('transfer-encoding');
    }

    const next: Headers = {};
    for (const [key, value] of Object.entries(headers)) {
        const normalized = key.toLowerCase();
        if ((crossOrigin || protocolDowngrade) && REDIRECT_SENSITIVE_HEADER_RE.test(normalized)) continue;
        if ((crossOrigin || protocolDowngrade) && stripped.has(normalized)) continue;
        if (bodyDropped && stripped.has(normalized)) continue;
        next[key] = value;
    }
    return next;
}

export function withoutBody(config: InternalRequestConfig): InternalRequestConfig {
    const entries = Object.entries(config).filter(([key]) => key !== 'data');
    return Object.fromEntries(entries) as InternalRequestConfig;
}

export function buildRedirectContext(statusCode: number, location: string, fromURL: string, toURL: string, headers: Headers): RedirectContext {
    return { statusCode, location, fromURL, toURL, headers };
}
