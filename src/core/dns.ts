import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';

import type SecurityManager from '../security/SecurityManager.js';
import type { InternalRequestConfig, LookupFunction } from '../types.js';

export type ResolvedAddress = { readonly address: string; readonly family: number };
type LookupCallback = (error: NodeJS.ErrnoException | null, address?: string | ResolvedAddress[], family?: number) => void;

export async function validateProxyTarget(url: URL, config: InternalRequestConfig, security: SecurityManager): Promise<void> {
    if (net.isIP(url.hostname)) return;
    const records = await dnsLookup(url.hostname, { all: true, verbatim: true });
    for (const record of records) security.validateResolvedAddress(config.url, record.address);
}

export async function createLookup(
    url: URL,
    config: InternalRequestConfig,
    security: SecurityManager,
    defaultLookup?: LookupFunction,
    isProxy = false
): Promise<LookupFunction | undefined> {
    const customLookup = config.lookup ?? defaultLookup;
    if (customLookup) return wrapLookup(customLookup, security, config.url, isProxy);

    if (net.isIP(url.hostname)) return undefined;

    const records = await dnsLookup(url.hostname, { all: true, verbatim: true });
    if (!isProxy) {
        for (const record of records) security.validateResolvedAddress(config.url, record.address);
    }

    return createPinnedLookup(records);
}

export function createPinnedLookup(records: readonly ResolvedAddress[]): LookupFunction {
    const pinned = [...records];

    const lookup: LookupFunction = (hostname: string, options: unknown, callback?: unknown): void => {
        const done = (typeof options === 'function' ? options : callback) as LookupCallback | undefined;
        if (!done) return;

        const lookupOptions = typeof options === 'function' ? undefined : options;
        const family = typeof lookupOptions === 'number'
            ? lookupOptions
            : isLookupOptions(lookupOptions) && typeof lookupOptions.family === 'number'
                ? lookupOptions.family
                : undefined;
        const all = isLookupOptions(lookupOptions) && lookupOptions.all === true;
        const matches = family ? pinned.filter(record => record.family === family) : pinned;

        if (matches.length === 0) {
            const error = Object.assign(new Error(`DNS resolution failed: ${hostname}`), { code: 'ENOTFOUND' });
            done(error);
            return;
        }

        if (all) {
            done(null, matches.map(record => ({ address: record.address, family: record.family })));
            return;
        }

        const selected = matches[0];
        if (!selected) return;
        done(null, selected.address, selected.family);
    };

    return lookup;
}

export function wrapLookup(lookup: LookupFunction, security: SecurityManager, url: string, isProxy = false): LookupFunction {
    const wrapped: LookupFunction = (hostname: string, options: unknown, callback?: unknown): void => {
        const done = (typeof options === 'function' ? options : callback) as LookupCallback | undefined;
        if (!done) return;

        const wrappedDone: LookupCallback = (error, address, family) => {
            if (error) {
                done(error);
                return;
            }

            try {
                if (Array.isArray(address) && !isProxy) {
                    address.forEach(item => security.validateResolvedAddress(url, item.address));
                } else if (typeof address === 'string' && !isProxy) {
                    security.validateResolvedAddress(url, address);
                }
            } catch (validationError: unknown) {
                done(normalizeError(validationError));
                return;
            }

            done(null, address, family);
        };

        if (typeof options === 'function') {
            (lookup as unknown as (lookupHostname: string, lookupCallback: LookupCallback) => void)(hostname, wrappedDone);
            return;
        }

        lookup(hostname, options as Parameters<LookupFunction>[1], wrappedDone);
    };

    return wrapped;
}

function isLookupOptions(value: unknown): value is { readonly family?: number; readonly all?: boolean } {
    return value !== null && typeof value === 'object';
}

function normalizeError(error: unknown): NodeJS.ErrnoException {
    if (error instanceof Error) return error;
    return new Error(String(error));
}
