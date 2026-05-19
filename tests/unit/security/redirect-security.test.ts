import assert from 'node:assert/strict';
import test from 'node:test';
import type * as SecurityModule from '../../../src/security/SecurityManager.js';
import type * as RedirectModule from '../../../src/core/redirect.js';

const securityEntry = '../../../../dist/esm/security/SecurityManager.js';
const redirectEntry = '../../../../dist/esm/core/redirect.js';

void test('SecurityManager blocks protocol downgrade and private redirects', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager();

    assert.throws(() => security.validateRedirect('https://api.example.com', 'http://api.example.com'), /downgrade/u);
    assert.throws(() => security.validateRedirect('https://api.example.com', 'https://127.0.0.1'), /SSRF/u);
});

void test('stripRedirectHeaders removes credentials and sensitive custom headers across origins', async () => {
    const { stripRedirectHeaders } = await import(redirectEntry) as typeof RedirectModule;
    const headers = stripRedirectHeaders({
        Authorization: 'Bearer secret',
        Cookie: 'sid=secret',
        'Proxy-Authorization': 'Basic secret',
        'X-Api-Key': 'secret',
        'X-Access-Token': 'secret',
        'X-Client-Secret': 'secret',
        'X-Safe-Header': 'ok',
    }, 'https://api.example.com/users', 'https://other.example.com/users', false);

    assert.equal(headers.Authorization, undefined);
    assert.equal(headers.Cookie, undefined);
    assert.equal(headers['Proxy-Authorization'], undefined);
    assert.equal(headers['X-Api-Key'], undefined);
    assert.equal(headers['X-Access-Token'], undefined);
    assert.equal(headers['X-Client-Secret'], undefined);
    assert.equal(headers['X-Safe-Header'], 'ok');
});

void test('stripRedirectHeaders removes body headers when redirect changes method to GET', async () => {
    const { stripRedirectHeaders } = await import(redirectEntry) as typeof RedirectModule;
    const headers = stripRedirectHeaders({
        'Content-Type': 'application/json',
        'Content-Length': '12',
        'Transfer-Encoding': 'chunked',
        Accept: 'application/json',
    }, 'https://api.example.com/users', 'https://api.example.com/users/1', true);

    assert.equal(headers['Content-Type'], undefined);
    assert.equal(headers['Content-Length'], undefined);
    assert.equal(headers['Transfer-Encoding'], undefined);
    assert.equal(headers.Accept, 'application/json');
});
