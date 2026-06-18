import { fetchAdapter } from '../adapters/fetch.js';
import { createNodeHttp2Adapter } from '../adapters/http2.js';
import { createNodeHttpAdapter, createNodeHttpAgents } from '../adapters/http.js';
import SecurityManager from '../security/SecurityManager.js';
import { NeutrxSecurityError } from './NeutrxError.js';
import { buildConfig } from './config.js';
import type { RequestAdapter, RequestAdapterConfig } from '../types.js';

/** Axios-style adapter names accepted by {@link getAdapter}, including aliases. */
export type AdapterSpec = RequestAdapterConfig | 'https' | 'xhr';

/**
 * Axios-compatible `getAdapter`. Resolves an adapter name (or a custom adapter
 * function, or an array tried in order) to a concrete {@link RequestAdapter}.
 *
 * Names: `http`/`https` → the Node HTTP/1.1 adapter, `http2` → the HTTP/2
 * adapter, `fetch`/`xhr` → the fetch adapter. Resolved Node adapters are wired
 * with a default {@link SecurityManager} so SSRF/redirect/TLS controls stay on.
 */
export function getAdapter(adapters: AdapterSpec | readonly AdapterSpec[]): RequestAdapter {
    const candidates: readonly AdapterSpec[] = Array.isArray(adapters) ? adapters : [adapters];
    const names: string[] = [];

    for (const candidate of candidates) {
        if (typeof candidate === 'function') return candidate;
        const resolved = resolveByName(candidate);
        if (resolved) return resolved;
        names.push(String(candidate));
    }

    throw new NeutrxSecurityError(`Unknown adapter: ${names.join(', ') || 'none'}`, { code: 'UNKNOWN_ADAPTER' });
}

function resolveByName(name: AdapterSpec): RequestAdapter | undefined {
    switch (name) {
        case 'fetch':
        case 'xhr':
            return fetchAdapter;
        case 'http':
        case 'https':
            return createNodeHttpAdapter({
                security: new SecurityManager(),
                defaults: buildConfig({}),
                agents: createNodeHttpAgents(),
            });
        case 'http2':
            return createNodeHttp2Adapter({
                security: new SecurityManager(),
                defaults: buildConfig({}),
            });
        default:
            return undefined;
    }
}
