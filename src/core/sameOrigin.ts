/**
 * Axios-compatible `isURLSameOrigin`. Returns `true` when `requestURL` resolves
 * to the same origin (protocol + host + port) as `baseURL`.
 *
 * In browsers `baseURL` defaults to the current document location, matching
 * axios's XSRF-token gate. In Node (no ambient location and no `baseURL`) it
 * returns `true`, mirroring axios's node platform which treats requests as
 * same-origin.
 */
export function isURLSameOrigin(requestURL: string, baseURL?: string): boolean {
    const ambient = typeof globalThis !== 'undefined'
        ? (globalThis as { readonly location?: { readonly href?: string } }).location?.href
        : undefined;
    const base = baseURL ?? ambient;
    if (!base) return true;

    try {
        const origin = new URL(base);
        const target = new URL(requestURL, base);
        return target.protocol === origin.protocol && target.host === origin.host;
    } catch {
        return false;
    }
}
