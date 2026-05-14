import assert from 'node:assert/strict';
import test from 'node:test';
import type * as SecurityModule from '../../../src/security/SecurityManager.js';

const securityEntry = '../../../../dist/esm/security/SecurityManager.js';

void test('SecurityManager blocks private and metadata hosts in balanced profile', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager({ enforceHTTPS: false });

    for (const url of [
        'http://localhost/',
        'http://127.0.0.1/',
        'http://[::1]/',
        'http://10.0.0.1/',
        'http://172.16.0.1/',
        'http://192.168.0.1/',
        'http://169.254.169.254/',
        'http://2130706433/',
        'http://0x7f000001/',
    ]) {
        assert.throws(() => security.validateURL(url), /SSRF/u, url);
    }
});

void test('SecurityManager development profile allows localhost but keeps metadata blocked', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager({ profile: 'development' });

    assert.equal(security.validateURL('http://localhost/').hostname, 'localhost');
    assert.throws(() => security.validateURL('http://169.254.169.254/'), /SSRF/u);
});

void test('SecurityManager allowedHosts and deniedHosts policies apply', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;

    assert.throws(() => new SecurityManager({ enforceHTTPS: false, allowedHosts: ['api.example.com'] }).validateURL('http://evil.example.com'), /not allowed/u);
    assert.throws(() => new SecurityManager({ enforceHTTPS: false, deniedHosts: ['*.blocked.test'] }).validateURL('http://api.blocked.test'), /denied/u);
});
