import { NeutrxSecurityError } from '../core/NeutrxError.js';
import { REDIRECT_CODES } from '../core/redirect.js';
import type { Headers, RequestAdapter } from '../types.js';

export interface SecureAdapterOptions {
    readonly allowRedirectResponses?: boolean;
    readonly requireSameConfigUrl?: boolean;
}

export function createSecureAdapter(adapter: RequestAdapter, options: SecureAdapterOptions = {}): RequestAdapter {
    return async config => {
        const expectedUrl = new URL(config.url).href;
        const response = await adapter(config);
        const responseUrl = new URL(response.config.url).href;

        if (options.requireSameConfigUrl !== false && responseUrl !== expectedUrl) {
            throw new NeutrxSecurityError('Custom adapter changed request URL outside Neutrx redirect handling', {
                code: 'CUSTOM_ADAPTER_URL_CHANGED',
                url: expectedUrl,
                method: config.method,
            });
        }

        if (!options.allowRedirectResponses && REDIRECT_CODES.has(response.status) && hasLocation(response.headers)) {
            throw new NeutrxSecurityError('Custom adapter returned redirect response without Neutrx redirect policy', {
                code: 'CUSTOM_ADAPTER_REDIRECT',
                url: expectedUrl,
                method: config.method,
            });
        }

        return response;
    };
}

function hasLocation(headers: Headers): boolean {
    return Object.keys(headers).some(key => key.toLowerCase() === 'location');
}
