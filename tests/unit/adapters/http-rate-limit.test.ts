import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';
const PAYLOAD_SIZE = 64 * 1024;
const RATE = 128 * 1024;

void test('node http adapter caps buffered upload bandwidth and reports realistic rates', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const payload = Buffer.alloc(PAYLOAD_SIZE, 'u');
    const uploadEvents: PackageEntry.ProgressEvent[] = [];
    const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ received: Buffer.concat(chunks).length, chunks: chunks.length }));
        });
    });
    await listen(server);

    try {
        const api = createLocalApi(Neutrx, server);
        const started = performance.now();
        const response = await api.post<{ readonly received: number; readonly chunks: number }, Buffer>('/upload-buffer', payload, {
            maxRate: [RATE, 0],
            onUploadProgress: event => uploadEvents.push(event),
        });
        const elapsed = performance.now() - started;

        assert.equal(response.data.received, payload.length);
        assert.ok(elapsed >= minimumElapsed(payload.length, RATE));
        assert.equal(uploadEvents.at(-1)?.loaded, payload.length);
        assert.equal(uploadEvents.at(-1)?.progress, 1);
        assertRealisticProgressRates(uploadEvents, RATE);
    } finally {
        await close(server);
    }
});

void test('node http adapter caps stream upload bandwidth across large input chunks', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const payload = Buffer.alloc(PAYLOAD_SIZE, 's');
    const server = http.createServer((request, response) => {
        let received = 0;
        let chunks = 0;
        request.on('data', (chunk: Buffer) => {
            received += chunk.length;
            chunks += 1;
        });
        request.on('end', () => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ received, chunks }));
        });
    });
    await listen(server);

    try {
        const api = createLocalApi(Neutrx, server);
        const started = performance.now();
        const response = await api.upload<{ readonly received: number; readonly chunks: number }, Readable>(
            '/upload-stream',
            Readable.from([payload]),
            {
                headers: { 'Content-Length': payload.length },
                maxRate: [RATE, 0],
            }
        );
        const elapsed = performance.now() - started;

        assert.equal(response.data.received, payload.length);
        assert.ok(response.data.chunks > 2);
        assert.ok(elapsed >= minimumElapsed(payload.length, RATE));
    } finally {
        await close(server);
    }
});

void test('node http adapter caps buffered download bandwidth and progress rates', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const payload = Buffer.alloc(PAYLOAD_SIZE, 'd');
    const downloadEvents: PackageEntry.ProgressEvent[] = [];
    const server = http.createServer((_request, response) => {
        response.setHeader('content-length', payload.length);
        response.end(payload);
    });
    await listen(server);

    try {
        const api = createLocalApi(Neutrx, server);
        const started = performance.now();
        const response = await api.get<Buffer>('/download-buffer', {
            responseType: 'buffer',
            maxRate: [0, RATE],
            onDownloadProgress: event => downloadEvents.push(event),
        });
        const elapsed = performance.now() - started;

        assert.equal(response.data.length, payload.length);
        assert.ok(elapsed >= minimumElapsed(payload.length, RATE));
        assert.equal(downloadEvents.at(-1)?.loaded, payload.length);
        assert.equal(downloadEvents.at(-1)?.progress, 1);
        assert.ok(downloadEvents.length > 3);
        assertRealisticProgressRates(downloadEvents, RATE);
    } finally {
        await close(server);
    }
});

void test('node http adapter caps response stream download bandwidth', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const payload = Buffer.alloc(PAYLOAD_SIZE, 'r');
    const downloadEvents: PackageEntry.ProgressEvent[] = [];
    const server = http.createServer((_request, response) => {
        response.setHeader('content-length', payload.length);
        response.end(payload);
    });
    await listen(server);

    try {
        const api = createLocalApi(Neutrx, server);
        const response = await api.get<Readable>('/download-stream', {
            responseType: 'stream',
            maxRate: [0, RATE],
            onDownloadProgress: event => downloadEvents.push(event),
        });
        const started = performance.now();
        const { buffer, chunks } = await collectReadable(response.data);
        const elapsed = performance.now() - started;

        assert.equal(buffer.length, payload.length);
        assert.ok(chunks > 2);
        assert.ok(elapsed >= minimumElapsed(payload.length, RATE));
        assert.equal(downloadEvents.at(-1)?.loaded, payload.length);
        assertRealisticProgressRates(downloadEvents, RATE);
    } finally {
        await close(server);
    }
});

function createLocalApi(
    Neutrx: typeof PackageEntry.default,
    server: http.Server
): ReturnType<typeof PackageEntry.default.create> {
    const address = server.address();
    assert.ok(isAddressInfo(address));
    return Neutrx.create({
        adapter: 'http',
        baseURL: `http://127.0.0.1:${address.port}`,
        timeout: 10_000,
        security: { enforceHTTPS: false, enableSSRFProtection: false, blockPrivateIPs: false },
    });
}

function minimumElapsed(size: number, rate: number): number {
    return (size / rate) * 1000 * 0.6;
}

function assertRealisticProgressRates(events: readonly PackageEntry.ProgressEvent[], expectedRate: number): void {
    const rates = events.map(event => event.rate).filter(rate => rate > 0).sort((left, right) => left - right);
    assert.ok(rates.length > 0);
    assert.ok((rates[Math.floor(rates.length / 2)] ?? 0) <= expectedRate * 2);
}

async function collectReadable(stream: Readable): Promise<{ readonly buffer: Buffer; readonly chunks: number }> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return { buffer: Buffer.concat(chunks), chunks: chunks.length };
}

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
