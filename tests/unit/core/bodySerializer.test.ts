import assert from 'node:assert/strict';
import test from 'node:test';
import type * as BodyModule from '../../../src/core/bodySerializer.js';
import type * as HeadersModule from '../../../src/core/headers.js';

const bodyEntry = '../../../../dist/core/bodySerializer.mjs';
const headersEntry = '../../../../dist/core/headers.mjs';

void test('body serializer converts nested objects to FormData with array policies', async () => {
    const { toFormData } = await import(bodyEntry) as typeof BodyModule;
    const data = { user: { name: 'Ada' }, tags: ['one', 'two'] };

    const indexed = toFormData(data, { indexes: true });
    assert.equal(indexed.get('user[name]'), 'Ada');
    assert.equal(indexed.get('tags[0]'), 'one');
    assert.equal(indexed.get('tags[1]'), 'two');

    const noIndexes = toFormData(data, { indexes: false });
    assert.deepEqual(noIndexes.getAll('tags[]'), ['one', 'two']);

    const repeated = toFormData(data, { indexes: null });
    assert.deepEqual(repeated.getAll('tags'), ['one', 'two']);
});

void test('body serializer detects circular references and depth limits', async () => {
    const { toFormData } = await import(bodyEntry) as typeof BodyModule;
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    assert.throws(() => toFormData(circular), /Circular body reference/u);
    assert.throws(() => toFormData({ a: { b: { c: true } } }, { maxDepth: 1 }), /depth limit/u);
});

void test('body serializer preserves pass-through bodies and safe content-types', async () => {
    const { serializeBody } = await import(bodyEntry) as typeof BodyModule;

    const form = new FormData();
    form.set('name', 'Ada');
    const formHeaders = {};
    const formBody = await serializeBody({ data: form, headers: formHeaders });
    assert.ok(Buffer.isBuffer(formBody));
    assert.match(String((formHeaders as Record<string, unknown>)['Content-Type']), /^multipart\/form-data/u);

    const urlHeaders = {};
    assert.equal(await serializeBody({ data: new URLSearchParams({ q: '1' }), headers: urlHeaders }), 'q=1');
    assert.equal((urlHeaders as Record<string, unknown>)['Content-Type'], 'application/x-www-form-urlencoded;charset=utf-8');

    const buffer = Buffer.from('abc');
    assert.equal(await serializeBody({ data: buffer, headers: {} }), buffer);
});

void test('body serializer honors false header sentinels for automatic content-types', async () => {
    const { serializeBody } = await import(bodyEntry) as typeof BodyModule;
    const { NeutrxHeaders } = await import(headersEntry) as typeof HeadersModule;
    const headers = new NeutrxHeaders({ 'Content-Type': false });

    assert.equal(await serializeBody({ data: { ok: true }, headers }), '{"ok":true}');
    assert.equal(headers.has('content-type'), true);
    assert.equal(headers.get('content-type'), false);
    assert.deepEqual(headers.toJSON(), {});
});
