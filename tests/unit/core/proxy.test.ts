import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import type * as ProxyModule from '../../../src/core/proxy.js';

const proxyEntry = '../../../../dist/esm/core/proxy.js';

void test('proxy resolution honors env, explicit config, false, and no_proxy', async () => {
    const { resolveProxy } = await import(proxyEntry) as typeof ProxyModule;

    assert.equal(resolveProxy(false, new URL('https://api.example.com'), { HTTPS_PROXY: 'http://proxy.local:8080' }), undefined);
    assert.equal(resolveProxy({ host: 'explicit.local', port: 9000 }, new URL('https://api.example.com'))?.host, 'explicit.local');
    assert.equal(resolveProxy(undefined, new URL('https://api.example.com'), { HTTPS_PROXY: 'http://proxy.local:8080' })?.port, 8080);
    assert.equal(resolveProxy(undefined, new URL('https://api.example.com'), { HTTPS_PROXY: 'http://proxy.local:8080', NO_PROXY: '.example.com' }), undefined);
});

void test('proxy helpers create auth headers and HTTPS CONNECT tunnels', async () => {
    const { createConnectTunnel, proxyAuthHeader } = await import(proxyEntry) as typeof ProxyModule;
    let connectLine = '';
    let authLine = '';

    const proxy = net.createServer(socket => {
        socket.once('data', chunk => {
            const request = chunk.toString('latin1');
            connectLine = request.split('\r\n')[0] ?? '';
            authLine = request.split('\r\n').find(line => line.toLowerCase().startsWith('proxy-authorization:')) ?? '';
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        });
    });

    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    try {
        const address = proxy.address();
        assert.ok(address && typeof address === 'object');
        const socket = await createConnectTunnel({
            proxy: { protocol: 'http', host: '127.0.0.1', port: address.port, auth: { username: 'u', password: 'p' } },
            target: new URL('https://target.example:443/path'),
        }, 1000);
        socket.destroy();

        assert.equal(connectLine, 'CONNECT target.example:443 HTTP/1.1');
        assert.equal(authLine, `Proxy-Authorization: ${proxyAuthHeader({ username: 'u', password: 'p' })}`);
    } finally {
        await new Promise<void>(resolve => proxy.close(() => resolve()));
    }
});

void test('proxy target strips proxy authorization on redirect safety helper', async () => {
    const { stripProxyAuthorization } = await import(proxyEntry) as typeof ProxyModule;
    assert.deepEqual(stripProxyAuthorization({ 'Proxy-Authorization': 'secret', Authorization: 'keep' }), { Authorization: 'keep' });
});
