import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';

void test('toFormData serializes plain objects and appends into a target FormData', async () => {
    const { toFormData } = await import(builtEntry) as typeof PackageEntry;

    const produced = toFormData({ user: { name: 'Ada' }, tags: ['x', 'y'] }, { indexes: true });
    assert.equal(produced.get('user[name]'), 'Ada');
    assert.equal(produced.get('tags[0]'), 'x');

    const target = new FormData();
    target.append('keep', '1');
    const returned = toFormData({ extra: 'v' }, target);
    assert.equal(returned, target);
    assert.equal(target.get('keep'), '1');
    assert.equal(target.get('extra'), 'v');
});

void test('formDataToJSON / formToJSON rebuild nested objects from bracket keys', async () => {
    const { formDataToJSON, formToJSON } = await import(builtEntry) as typeof PackageEntry;

    const form = new FormData();
    form.append('user[name]', 'Ada');
    form.append('user[roles][0]', 'admin');
    form.append('user[roles][1]', 'dev');

    const json = formDataToJSON(form);
    assert.deepEqual(json, { user: { name: 'Ada', roles: ['admin', 'dev'] } });
    assert.equal(formToJSON, formDataToJSON);
    assert.equal(formDataToJSON(null), null);
});

void test('formDataToJSON drops prototype-pollution keys', async () => {
    const { formDataToJSON } = await import(builtEntry) as typeof PackageEntry;

    const form = new FormData();
    form.append('__proto__[polluted]', 'yes');
    form.append('safe', 'ok');

    const json = formDataToJSON(form) as Record<string, unknown>;
    assert.equal(json.safe, 'ok');
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

void test('HttpStatusCode exposes name and reverse lookups', async () => {
    const { HttpStatusCode } = await import(builtEntry) as typeof PackageEntry;

    assert.equal(HttpStatusCode.NotFound, 404);
    assert.equal(HttpStatusCode.InternalServerError, 500);
    assert.equal(HttpStatusCode[200], 'Ok');
    assert.equal(HttpStatusCode.NetworkAuthenticationRequired, 511);
});

void test('isURLSameOrigin compares origin against an explicit base', async () => {
    const { isURLSameOrigin } = await import(builtEntry) as typeof PackageEntry;

    assert.equal(isURLSameOrigin('https://api.example.com/v1', 'https://api.example.com'), true);
    assert.equal(isURLSameOrigin('/relative', 'https://api.example.com'), true);
    assert.equal(isURLSameOrigin('https://evil.example.com', 'https://api.example.com'), false);
    assert.equal(isURLSameOrigin('http://api.example.com', 'https://api.example.com'), false);
    assert.equal(isURLSameOrigin('https://api.example.com'), true);
});

void test('mergeConfig deep-merges nested option groups with config2 winning', async () => {
    const { mergeConfig } = await import(builtEntry) as typeof PackageEntry;

    const merged = mergeConfig(
        { timeout: 1000, security: { profile: 'strict', enforceHTTPS: true } },
        { timeout: 2000, security: { enforceHTTPS: false } }
    );

    assert.equal(merged.timeout, 2000);
    assert.equal(merged.security?.profile, 'strict');
    assert.equal(merged.security?.enforceHTTPS, false);
});

void test('getAdapter resolves names, custom functions, and arrays', async () => {
    const { getAdapter, fetchAdapter } = await import(builtEntry) as typeof PackageEntry;

    assert.equal(getAdapter('fetch'), fetchAdapter);
    assert.equal(getAdapter('xhr'), fetchAdapter);
    assert.equal(typeof getAdapter('http'), 'function');
    assert.equal(typeof getAdapter('http2'), 'function');

    const custom = (): Promise<never> => Promise.reject(new Error('unused'));
    assert.equal(getAdapter(custom), custom);
    assert.equal(getAdapter(['fetch', 'http']), fetchAdapter);
    assert.throws(() => getAdapter('nope' as 'fetch'), /Unknown adapter/u);
});
