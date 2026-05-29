import assert from 'node:assert/strict';
import test from 'node:test';
import type * as DnsModule from '../../../src/core/dns.js';
import type * as SecurityModule from '../../../src/security/SecurityManager.js';
import type { LookupFunction } from '../../../src/types.js';

const dnsEntry = '../../../../dist/core/dns.mjs';
const securityEntry = '../../../../dist/security/SecurityManager.mjs';

void test('wrapLookup rejects mixed DNS answers when any address violates SSRF policy', async () => {
    const { wrapLookup } = await import(dnsEntry) as typeof DnsModule;
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager({ enforceHTTPS: false });
    const lookup = ((_hostname: string, options: unknown, callback?: unknown): void => {
        const done = (typeof options === 'function' ? options : callback) as (
            error: NodeJS.ErrnoException | null,
            address?: readonly { readonly address: string; readonly family: number }[],
            family?: number
        ) => void;
        done(null, [
            { address: '93.184.216.34', family: 4 },
            { address: '127.0.0.1', family: 4 },
        ]);
    }) as LookupFunction;

    const wrapped = wrapLookup(lookup, security, 'http://public.example.test/');
    await new Promise<void>((resolve, reject) => {
        wrapped('public.example.test', { all: true }, error => {
            try {
                assert.ok(error);
                assert.match(error.message, /SSRF/u);
                resolve();
            } catch (assertionError) {
                reject(assertionError instanceof Error ? assertionError : new Error(String(assertionError)));
            }
        });
    });
});

void test('createPinnedLookup supports family filtering, all records, and callback shorthand', async () => {
    const { createPinnedLookup } = await import(dnsEntry) as typeof DnsModule;
    const lookup = createPinnedLookup([
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);

    await new Promise<void>((resolve, reject) => {
        lookup('example.com', { all: true }, (error, address) => {
            try {
                assert.equal(error, null);
                assert.deepEqual(address, [
                    { address: '93.184.216.34', family: 4 },
                    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
                ]);
                resolve();
            } catch (assertionError) {
                reject(assertionError instanceof Error ? assertionError : new Error(String(assertionError)));
            }
        });
    });

    await new Promise<void>((resolve, reject) => {
        lookup('example.com', { family: 6 }, (error, address, family) => {
            try {
                assert.equal(error, null);
                assert.equal(address, '2606:2800:220:1:248:1893:25c8:1946');
                assert.equal(family, 6);
                resolve();
            } catch (assertionError) {
                reject(assertionError instanceof Error ? assertionError : new Error(String(assertionError)));
            }
        });
    });

    await new Promise<void>((resolve, reject) => {
        lookup('example.com', {}, (error, address, family) => {
            try {
                assert.equal(error, null);
                assert.equal(address, '93.184.216.34');
                assert.equal(family, 4);
                resolve();
            } catch (assertionError) {
                reject(assertionError instanceof Error ? assertionError : new Error(String(assertionError)));
            }
        });
    });

    await new Promise<void>((resolve, reject) => {
        lookup('example.com', { family: 7 }, error => {
            try {
                assert.equal(error?.code, 'ENOTFOUND');
                resolve();
            } catch (assertionError) {
                reject(assertionError instanceof Error ? assertionError : new Error(String(assertionError)));
            }
        });
    });
});

void test('wrapLookup passes lookup errors and skips proxy SSRF validation', async () => {
    const { wrapLookup } = await import(dnsEntry) as typeof DnsModule;
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager({ enforceHTTPS: false });
    const failing = ((_hostname: string, options: unknown, callback?: unknown): void => {
        const done = (typeof options === 'function' ? options : callback) as (error: NodeJS.ErrnoException | null) => void;
        done(Object.assign(new Error('dns down'), { code: 'EAI_AGAIN' }));
    }) as LookupFunction;

    await new Promise<void>((resolve, reject) => {
        wrapLookup(failing, security, 'http://public.example.test/')('public.example.test', {}, error => {
            try {
                assert.equal(error?.code, 'EAI_AGAIN');
                resolve();
            } catch (assertionError) {
                reject(assertionError instanceof Error ? assertionError : new Error(String(assertionError)));
            }
        });
    });

    const privateLookup = ((_hostname: string, options: unknown, callback?: unknown): void => {
        const done = (typeof options === 'function' ? options : callback) as (
            error: NodeJS.ErrnoException | null,
            address?: string,
            family?: number
        ) => void;
        done(null, '127.0.0.1', 4);
    }) as LookupFunction;

    await new Promise<void>((resolve, reject) => {
        wrapLookup(privateLookup, security, 'http://public.example.test/', true)('proxy.local', {}, (error, address, family) => {
            try {
                assert.equal(error, null);
                assert.equal(address, '127.0.0.1');
                assert.equal(family, 4);
                resolve();
            } catch (assertionError) {
                reject(assertionError instanceof Error ? assertionError : new Error(String(assertionError)));
            }
        });
    });
});
