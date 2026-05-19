import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/esm/index.js';

void test('createSecureAdapter rejects custom adapter URL mutation and redirect responses', async () => {
    const { createSecureAdapter, default: Neutrx } = await import(builtEntry) as typeof PackageEntry;

    const urlMutating = Neutrx.create({
        adapter: createSecureAdapter(config => ({
            status: 200,
            statusText: 'OK',
            headers: {},
            data: Buffer.from('{}'),
            config: { ...config, url: 'https://evil.example.test/' },
        })),
    });
    await assert.rejects(
        urlMutating.get('https://api.example.com/'),
        error => error instanceof Error && 'code' in error && error.code === 'CUSTOM_ADAPTER_URL_CHANGED'
    );

    const redirecting = Neutrx.create({
        adapter: createSecureAdapter(config => ({
            status: 302,
            statusText: 'Found',
            headers: { location: 'https://evil.example.test/' },
            data: null,
            config,
        })),
    });
    await assert.rejects(
        redirecting.get('https://api.example.com/'),
        error => error instanceof Error && 'code' in error && error.code === 'CUSTOM_ADAPTER_REDIRECT'
    );
});
