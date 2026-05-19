export { fetchAdapter } from './fetch.js';
export { getHttp2SessionStats, http2Adapter } from './http2.js';
export { createSecureAdapter, type SecureAdapterOptions } from './secure.js';
export const HttpAdapter = 'http' as const;
export const FetchAdapter = 'fetch' as const;
export const Http2Adapter = 'http2' as const;
