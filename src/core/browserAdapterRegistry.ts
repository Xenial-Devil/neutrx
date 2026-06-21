import { fetchAdapter } from '../adapters/browser.js';
import { NeutrxSecurityError } from './NeutrxError.js';
import type { RequestAdapter, RequestAdapterConfig } from '../types.js';

/** Adapter names accepted by the browser {@link getAdapter} (fetch only). */
export type BrowserAdapterSpec = RequestAdapterConfig | 'xhr';

/**
 * Browser-build counterpart of {@link getAdapter}. Only the fetch adapter is
 * available; `fetch`/`xhr` resolve to it. Node adapters (`http`/`http2`) cannot
 * provide Node-level network security and are unavailable here.
 */
export function getAdapter(adapters: BrowserAdapterSpec | readonly BrowserAdapterSpec[]): RequestAdapter {
    const candidates: readonly BrowserAdapterSpec[] = Array.isArray(adapters) ? adapters : [adapters];
    const names: string[] = [];

    for (const candidate of candidates) {
        if (typeof candidate === 'function') return candidate;
        if (candidate === 'fetch' || candidate === 'xhr') return fetchAdapter;
        names.push(String(candidate));
    }

    throw new NeutrxSecurityError(`Unknown or unavailable browser adapter: ${names.join(', ') || 'none'}`, { code: 'UNKNOWN_ADAPTER' });
}
