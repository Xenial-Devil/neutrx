import assert from 'node:assert/strict';
import test from 'node:test';
import type * as SecurityModule from '../../../src/security/SecurityManager.js';

const securityEntry = '../../../../dist/esm/security/SecurityManager.js';

void test('SecurityManager blocks private and metadata hosts in standard profile', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager({ enforceHTTPS: false });

    for (const url of [
        'http://localhost/',
        'http://127.0.0.1/',
        'http://0.0.0.0/',
        'http://[::1]/',
        'http://10.0.0.1/',
        'http://100.64.0.1/',
        'http://172.16.0.1/',
        'http://172.31.255.255/',
        'http://192.168.0.1/',
        'http://169.254.1.1/',
        'http://169.254.169.254/',
        'http://2130706433/',
        'http://0x7f000001/',
        'http://0177.0.0.1/',
        'http://017700000001/',
    ]) {
        assert.throws(() => security.validateURL(url), /SSRF/u, url);
    }
});

void test('SecurityManager legacy profile allows trusted localhost and HTTP', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager({ profile: 'legacy' });

    assert.equal(security.validateURL('http://localhost/').hostname, 'localhost');
    assert.equal(security.validateURL('http://127.0.0.1/').hostname, '127.0.0.1');
});

void test('SecurityManager maps deprecated profile aliases for compatibility', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;

    const balanced = new SecurityManager({ profile: 'balanced', enforceHTTPS: false });
    assert.throws(() => balanced.validateURL('http://127.0.0.1/'), /SSRF/u);

    const standardAlias = new SecurityManager({ profile: 'balanced' });
    assert.throws(() => standardAlias.validateURL('http://127.0.0.1/'), /SSRF/u);
});

void test('SecurityManager strict profile requires HTTPS and blocks metadata variants', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager({ profile: 'strict' });

    assert.throws(() => security.validateURL('http://api.example.com/'), /Protocol|HTTPS required/u);
    assert.throws(() => security.validateURL('https://169.254.169.254/'), /SSRF/u);
    assert.throws(() => security.validateURL('https://100.100.100.200/'), /SSRF/u);
    assert.throws(() => security.validateURL('https://[fd00:ec2::254]/'), /SSRF/u);
    assert.throws(() => security.validateURL('https://[::ffff:127.0.0.1]/'), /SSRF/u);
});

void test('SecurityManager blocks URL credential confusion in standard and strict profiles', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;

    assert.throws(() => new SecurityManager({ enforceHTTPS: false }).validateURL('http://user:pass@example.com/'), /Credentials/u);
    assert.throws(() => new SecurityManager({ profile: 'strict' }).validateURL('https://127.0.0.1@example.com/'), /Credentials/u);
    assert.equal(new SecurityManager({ profile: 'legacy' }).validateURL('http://user:pass@example.com/').hostname, 'example.com');
});

void test('SecurityManager normalizes IDN allow-list entries to punycode', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager({ enforceHTTPS: false, allowedHosts: ['bücher.example'] });

    assert.equal(security.validateURL('http://xn--bcher-kva.example/').hostname, 'xn--bcher-kva.example');
});

void test('SecurityManager allowedHosts and deniedHosts policies apply', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;

    assert.throws(() => new SecurityManager({ enforceHTTPS: false, allowedHosts: ['api.example.com'] }).validateURL('http://evil.example.com'), /not allowed/u);
    assert.throws(() => new SecurityManager({ enforceHTTPS: false, deniedHosts: ['*.blocked.test'] }).validateURL('http://api.blocked.test'), /denied/u);
});
