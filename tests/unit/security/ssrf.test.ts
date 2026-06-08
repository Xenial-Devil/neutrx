import assert from 'node:assert/strict';
import type { PeerCertificate } from 'node:tls';
import test from 'node:test';
import type * as SecurityModule from '../../../src/security/SecurityManager.js';
import type { InternalRequestConfig } from '../../../src/types.js';

const securityEntry = '../../../../dist/security/SecurityManager.mjs';

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
        'http://[::ffff:7f00:1]/',
        'http://[::ffff:169.254.169.254]/',
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

void test('SecurityManager treats socketPath requests as local HTTP transport', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager({
        profile: 'strict',
        egressPolicy: { mode: 'public-api', allowedHosts: ['api.example.com'] },
    });
    const config = {
        url: 'http://127.0.0.1/v1/version',
        method: 'GET',
        headers: {},
        socketPath: '/var/run/docker.sock',
        requestId: 'socket-test',
    } as unknown as InternalRequestConfig;

    assert.equal(security.validateRequest(config).url, 'http://127.0.0.1/v1/version');
    assert.throws(() => security.validateSocketURL('https://docker/v1/version'), /HTTP URLs only/u);
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

void test('SecurityManager egress policy blocks non-public, ports, protocols, and redirects', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const publicApi = new SecurityManager({
        enforceHTTPS: false,
        egressPolicy: { mode: 'public-api', allowedHosts: ['api.example.com'] },
    });

    assert.equal(publicApi.validateURL('https://api.example.com/users').hostname, 'api.example.com');
    assert.throws(() => publicApi.validateURL('http://api.example.com/users'), /HTTPS|Protocol/u);
    assert.throws(() => publicApi.validateURL('https://api.example.com:8443/users'), /Port/u);
    assert.throws(() => publicApi.validateResolvedAddress('https://api.example.com/users', '10.0.0.4'), /not public/u);
    assert.throws(() => publicApi.validateRedirect('https://api.example.com/users', 'https://evil.example.com/'), /not allowed/u);

    assert.deepEqual(publicApi.getEgressPolicyAudit().allowedPorts, [443]);
});

void test('SecurityManager validates TLS SNI override against egress policy', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager({
        egressPolicy: { allowedSni: ['api.example.com'] },
    });

    assert.doesNotThrow(() => security.validateSNI('https://api.example.com/users', 'api.example.com'));
    assert.throws(() => security.validateSNI('https://api.example.com/users', 'evil.example.com'), /SNI host/u);
});

void test('SecurityManager egress policy can allow reviewed internal CIDRs only', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const internal = new SecurityManager({
        enforceHTTPS: false,
        blockPrivateIPs: true,
        egressPolicy: {
            mode: 'internal-service',
            allowedCidrs: ['10.42.0.0/16'],
            deniedCidrs: ['10.42.9.0/24'],
            allowedPorts: [8080],
        },
    });

    assert.equal(internal.validateURL('http://10.42.1.10:8080/health').hostname, '10.42.1.10');
    assert.throws(() => internal.validateURL('http://10.42.9.10:8080/health'), /denied CIDR/u);
    assert.throws(() => internal.validateURL('http://10.43.1.10:8080/health'), /outside allowed CIDRs/u);
    assert.throws(() => internal.validateURL('http://10.42.1.10:9090/health'), /Port/u);
});

void test('SecurityManager certificate pins support rotation windows and fail closed', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager();
    security.pinCertificate('api.example.com', 'a'.repeat(64), { expiresAt: Date.now() - 1000 });

    assert.throws(
        () => security.checkServerIdentity('api.example.com', { fingerprint256: 'AA:AA' } as PeerCertificate),
        /Certificate pin mismatch/u
    );
    assert.throws(() => security.pinCertificate('api.example.com', 'not-a-fingerprint'), /Invalid SHA-256/u);
});

void test('SecurityManager rejects prototype pollution keys in request bodies', async () => {
    const { default: SecurityManager } = await import(securityEntry) as typeof SecurityModule;
    const security = new SecurityManager();
    const config = {
        url: 'https://api.example.com/users',
        method: 'POST',
        headers: {},
        data: JSON.parse('{"safe":true,"__proto__":{"polluted":true}}') as unknown,
        requestId: 'prototype-pollution-test',
    } as unknown as InternalRequestConfig;

    assert.throws(() => security.validateRequest(config), /Prototype pollution attempt/u);
    assert.equal((Object.prototype as { polluted?: unknown }).polluted, undefined);
});
