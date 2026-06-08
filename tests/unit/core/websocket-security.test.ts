import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';

void test('node ws rejects unsolicited server subprotocols and closes the connection', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const server = http.createServer();
    const sockets = new Set<Duplex>();
    const error = deferred<Error>();
    const closed = deferred<void>();
    let opened = false;

    server.on('upgrade', (request, socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        acceptWebSocketUpgrade(request, socket, 'unsolicited.v1');
    });

    const port = await listen(server);
    const api = Neutrx.create({
        baseURL: `http://127.0.0.1:${port}`,
        security: { profile: 'legacy' },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
        performance: { enableCaching: false },
    });

    try {
        const connection = await api.ws('/protocol', {
            onOpen: () => {
                opened = true;
            },
            onError: event => {
                if (event.error) error.resolve(event.error);
            },
            onClose: () => closed.resolve(),
        });

        const received = await error.promise;
        await closed.promise;
        assert.equal((received as Error & { readonly code?: string }).code, 'WEBSOCKET_UPGRADE_FAILED');
        assert.equal(opened, false);
        assert.equal(connection.readyState, 3);
    } finally {
        for (const socket of sockets) socket.destroy();
        api.destroy();
        await closeServer(server);
    }
});

void test('node ws revalidates interceptor-rewritten upgrade targets', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        baseURL: 'https://api.example.com',
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
        performance: { enableCaching: false },
    });
    api.interceptors.request.use(config => ({ ...config, url: 'http://127.0.0.1/private' }));

    try {
        await assert.rejects(
            api.ws('/socket'),
            error => error instanceof Error && (error as Error & { readonly code?: string }).code === 'SSRF_BLOCKED'
        );
    } finally {
        api.destroy();
    }
});

function acceptWebSocketUpgrade(request: http.IncomingMessage, socket: Duplex, protocol?: string): void {
    const key = String(request.headers['sec-websocket-key'] ?? '');
    const accept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
    socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        ...(protocol ? [`Sec-WebSocket-Protocol: ${protocol}`] : []),
        '',
        '',
    ].join('\r\n'));
}

function listen(server: http.Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            const address = server.address();
            assert.ok(address && typeof address === 'object');
            resolve(address.port);
        });
    });
}

function closeServer(server: http.Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(error => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
    let resolveValue!: (value: T) => void;
    const promise = new Promise<T>(resolve => {
        resolveValue = resolve;
    });
    return { promise, resolve: resolveValue };
}
