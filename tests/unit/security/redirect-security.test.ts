import assert from 'node:assert/strict';
import test from 'node:test';
import type * as SecurityModule from '../../../src/security/SecurityManager.js';

const securityEntry = '../../../../dist/esm/security/SecurityManager.js';

void test('SecurityManager blocks protocol downgrade and private redirects', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager();

    assert.throws(() => security.validateRedirect('https://api.example.com', 'http://api.example.com'), /downgrade/u);
    assert.throws(() => security.validateRedirect('https://api.example.com', 'https://127.0.0.1'), /SSRF/u);
});
