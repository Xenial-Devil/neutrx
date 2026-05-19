import assert from 'node:assert/strict';
import test from 'node:test';
import type * as DnsModule from '../../../src/core/dns.js';
import type * as SecurityModule from '../../../src/security/SecurityManager.js';
import type { LookupFunction } from '../../../src/types.js';

const dnsEntry = '../../../../dist/esm/core/dns.js';
const securityEntry = '../../../../dist/esm/security/SecurityManager.js';

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
