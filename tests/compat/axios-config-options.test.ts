import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import zlib from 'node:zlib';
import type * as PackageEntry from '../../src/index.js';

const builtEntry = '../../../dist/index.mjs';

void test('axios-compatible redirect, decompression, and response encoding options apply from defaults', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const redirectContexts: PackageEntry.RedirectContext[] = [];
    const captured: { redirectedHeader: string | undefined } = { redirectedHeader: undefined };
    const latin1Payload = Buffer.from([0xe9]);
    const jsonPayload = Buffer.from(JSON.stringify({ ok: true }));
    const zipped = zlib.gzipSync(jsonPayload);

    const server = http.createServer((request, response) => {
        if (request.url === '/redirect') {
            response.statusCode = 302;
            response.setHeader('location', '/latin1');
            response.end();
            return;
        }

        if (request.url === '/latin1') {
            captured.redirectedHeader = headerValue(request.headers['x-before-redirect']);
            response.setHeader('content-type', 'text/plain');
            response.end(latin1Payload);
            return;
        }

        response.setHeader('content-type', 'application/json');
        response.setHeader('content-encoding', 'gzip');
        response.end(zipped);
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            beforeRedirect(context) {
                redirectContexts.push(context);
                context.headers['X-Before-Redirect'] = 'yes';
            },
            decompress: false,
            responseEncoding: 'latin1',
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        const decoded = await api.get<string>('/redirect', { responseType: 'text' });
        assert.equal(decoded.data, 'é');
        assert.equal(captured.redirectedHeader, 'yes');
        assert.equal(redirectContexts.length, 1);
        assert.equal(redirectContexts[0]?.fromURL, `http://127.0.0.1:${address.port}/redirect`);
        assert.equal(redirectContexts[0]?.toURL, `http://127.0.0.1:${address.port}/latin1`);

        const compressed = await api.get<Buffer>('/gzip', { responseType: 'buffer' });
        assert.equal(Buffer.compare(compressed.data, zipped), 0);
    } finally {
        await close(server);
    }
});

void test('allowAbsoluteUrls false combines absolute request URLs with baseURL', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        baseURL: 'https://api.example.com/root',
        allowAbsoluteUrls: false,
        performance: { enableCaching: false },
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({
                url: config.url,
                allowAbsoluteUrls: config.allowAbsoluteUrls,
            })),
            config,
        }),
    });

    const forced = await api.get('https://evil.example/users', { params: { page: 1 } });
    assert.deepEqual(forced.data, {
        url: 'https://api.example.com/root/https://evil.example/users?page=1',
        allowAbsoluteUrls: false,
    });
    assert.equal(
        api.getUri({ url: 'https://evil.example/users', params: { page: 1 } }),
        'https://api.example.com/root/https://evil.example/users?page=1'
    );

    const direct = await api.get('https://direct.example/users', { allowAbsoluteUrls: true });
    assert.deepEqual(direct.data, {
        url: 'https://direct.example/users',
        allowAbsoluteUrls: true,
    });
});

void test('transitional.clarifyTimeoutError switches timeout error codes', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const server = http.createServer((_request, response) => {
        setTimeout(() => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ok: true }));
        }, 100);
    });
    await listen(server);

    try {
        const address = server.address();
        assert.ok(isAddressInfo(address));
        const api = Neutrx.create({
            baseURL: `http://127.0.0.1:${address.port}`,
            timeout: 20,
            resilience: { enableRetry: false },
            security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
        });

        await assert.rejects(
            api.get('/slow', { transitional: { clarifyTimeoutError: false } }),
            error => timeoutCode(error) === 'ECONNABORTED'
        );
        await assert.rejects(
            api.get('/slow', { transitional: { clarifyTimeoutError: true } }),
            error => timeoutCode(error) === 'ETIMEDOUT'
        );
    } finally {
        await close(server);
    }
});

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
    return address !== null && typeof address === 'object';
}

function listen(server: http.Server): Promise<void> {
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });
}

function close(server: http.Server): Promise<void> {
    return new Promise(resolve => {
        server.close(() => resolve());
    });
}

function headerValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value.join(', ');
    return value;
}

function timeoutCode(error: unknown): string | undefined {
    return error instanceof Error ? (error as Error & { readonly code?: string }).code : undefined;
}
