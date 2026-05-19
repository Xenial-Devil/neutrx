import assert from 'node:assert/strict';
import test from 'node:test';
import type * as HeadersModule from '../../../src/core/headers.js';

const headersEntry = '../../../../dist/esm/core/headers.js';

void test('NeutrxHeaders supports case-insensitive operations and casing preservation', async () => {
    const { NeutrxHeaders } = await import(headersEntry) as typeof HeadersModule;
    const headers = new NeutrxHeaders({ 'content-type': 'text/plain' });

    headers.set('Content-Type', 'application/json');
    headers.setBearerAuth('secret');

    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('CONTENT-TYPE'), 'application/json');
    assert.equal(headers.has('authorization'), true);
    assert.deepEqual(headers.toJSON(), {
        'content-type': 'application/json',
        Authorization: 'Bearer secret',
    });

    headers.delete('CONTENT-TYPE');
    assert.equal(headers.has('content-type'), false);
});

void test('NeutrxHeaders rejects invalid names and CRLF values', async () => {
    const { NeutrxHeaders } = await import(headersEntry) as typeof HeadersModule;

    assert.throws(() => new NeutrxHeaders().set('Bad Header', 'x'), /Header name/u);
    assert.throws(() => new NeutrxHeaders().set('__proto__', 'x'), /Header name/u);
    assert.throws(() => new NeutrxHeaders().set('constructor', 'x'), /Header name/u);
    assert.throws(() => new NeutrxHeaders().set('prototype', 'x'), /Header name/u);
    assert.throws(() => new NeutrxHeaders().set('X-Test', 'ok\r\nInjected: yes'), /CRLF/u);
});

void test('NeutrxHeaders redacts sensitive values and preserves normal headers', async () => {
    const { NeutrxHeaders } = await import(headersEntry) as typeof HeadersModule;
    const headers = new NeutrxHeaders({
        Authorization: 'Bearer secret',
        Cookie: 'sid=secret',
        'Proxy-Authorization': 'Basic secret',
        'X-Trace': 'visible',
    });

    assert.deepEqual(headers.redactSensitive(), {
        Authorization: '[REDACTED]',
        Cookie: '[REDACTED]',
        'Proxy-Authorization': '[REDACTED]',
        'X-Trace': 'visible',
    });
});

void test('NeutrxHeaders safely normalizes duplicates and set-cookie arrays', async () => {
    const { NeutrxHeaders } = await import(headersEntry) as typeof HeadersModule;
    const headers = new NeutrxHeaders({ Accept: 'json', accept: 'text', 'Set-Cookie': ['a=1'] });
    headers.set('set-cookie', 'b=2');

    assert.equal(headers.get('ACCEPT'), 'text');
    assert.deepEqual(headers.getSetCookie(), ['a=1', 'b=2']);
});
