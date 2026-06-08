import assert from 'node:assert/strict';
import test from 'node:test';
import type * as HeadersModule from '../../../src/core/headers.js';

const headersEntry = '../../../../dist/core/headers.mjs';

void test('NeutrxHeaders supports case-insensitive operations and casing preservation', async () => {
    const { NeutrxHeaders } = await import(headersEntry) as typeof HeadersModule;
    const headers = new NeutrxHeaders({ 'content-type': 'text/plain' });

    headers.set('Content-Type', 'application/json');
    headers.setBearerAuth('secret');

    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('CONTENT-TYPE'), 'application/json');
    assert.equal(headers.getAuthorization(), 'Bearer secret');
    assert.equal(headers.has('authorization'), true);
    assert.deepEqual([...headers], [
        ['content-type', 'application/json'],
        ['Authorization', 'Bearer secret'],
    ]);
    assert.deepEqual(headers.toJSON(), {
        'content-type': 'application/json',
        Authorization: 'Bearer secret',
    });
    assert.deepEqual([...headers.entries()], [...headers]);
    assert.deepEqual([...headers.keys()], ['content-type', 'Authorization']);
    assert.deepEqual([...headers.values()], ['application/json', 'Bearer secret']);
    const visited: string[] = [];
    headers.forEach((value, name, collection) => {
        assert.equal(collection, headers);
        visited.push(`${name}:${String(value)}`);
    });
    assert.deepEqual(visited, ['content-type:application/json', 'Authorization:Bearer secret']);

    headers.delete('CONTENT-TYPE');
    assert.equal(headers.has('content-type'), false);

    headers.setContentType('application/json').setAuthorization('Bearer secret').setUserAgent('neutrx-test');
    assert.equal(headers.get('user-agent'), 'neutrx-test');
    headers.setContentType(null).setAuthorization(false);
    assert.equal(headers.has('Content-Type'), false);
    assert.equal(headers.has('Authorization'), true);
    assert.equal(headers.get('Authorization'), false);
    assert.equal(headers.getAuthorization(), undefined);
    assert.deepEqual(headers.toJSON(), { 'User-Agent': 'neutrx-test' });

    const merged = NeutrxHeaders.concat(
        { Authorization: 'Bearer stale', Accept: 'json' },
        { authorization: false, 'X-Trace': 'visible' }
    );
    assert.deepEqual(merged.toJSON(), {
        Accept: 'json',
        'X-Trace': 'visible',
    });
    assert.equal(merged.has('Authorization'), true);
});

void test('NeutrxHeaders supports iterable and Headers-like sources', async () => {
    const { NeutrxHeaders, toOutgoingHeaders } = await import(headersEntry) as typeof HeadersModule;
    const iterable = new Map<string, string | false>([
        ['Content-Type', 'application/json'],
        ['content-type', 'text/plain'],
        ['Authorization', false],
    ]);
    const webHeaders = new Headers({ Accept: 'application/json' });
    const headers = NeutrxHeaders.concat(iterable, webHeaders);

    assert.equal(headers.get('Content-Type'), 'text/plain');
    assert.equal(headers.get('accept'), 'application/json');
    assert.equal(headers.get('authorization'), false);
    assert.deepEqual(Object.entries(toOutgoingHeaders(headers)).filter(([name]) => name.toLowerCase() === 'content-type'), [
        ['Content-Type', 'text/plain'],
    ]);
    assert.equal(Object.hasOwn(toOutgoingHeaders(headers), 'Authorization'), false);
});

void test('request header normalization accepts plain objects and NeutrxHeaders without mutating inputs', async () => {
    const { NeutrxHeaders, normalizeRequestHeaders } = await import(headersEntry) as typeof HeadersModule;
    const plain = { Authorization: 'Bearer plain' };
    const collection = new NeutrxHeaders({ Authorization: 'Bearer collection' });

    const normalizedPlain = normalizeRequestHeaders(plain);
    const normalizedCollection = normalizeRequestHeaders(collection);

    assert.ok(normalizedPlain instanceof NeutrxHeaders);
    assert.ok(normalizedCollection instanceof NeutrxHeaders);
    assert.equal(normalizedPlain.get('authorization'), 'Bearer plain');
    assert.equal(normalizedCollection.get('authorization'), 'Bearer collection');

    normalizedPlain.set('Authorization', 'Bearer normalized-plain');
    normalizedCollection.set('Authorization', 'Bearer normalized-collection');
    assert.equal(plain.Authorization, 'Bearer plain');
    assert.equal(collection.get('Authorization'), 'Bearer collection');
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
