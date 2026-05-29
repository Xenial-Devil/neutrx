import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientConfig, EgressPolicyConfig, SecurityProfile, SecurityProfileInput, ServiceDiscoveryConfig } from '../../src/index.js';

void test('public config types expose backend security and retry options', () => {
    const profile: SecurityProfile = 'strict';
    const migrationProfile: SecurityProfileInput = 'balanced';
    const egressPolicy: EgressPolicyConfig = { mode: 'webhook-target', allowedPorts: [443], requirePublicDns: true };
    const serviceDiscovery: ServiceDiscoveryConfig = {
        resolver: [{ url: 'https://api-a.example.com', weight: 2 }, 'https://api-b.example.com'],
        strategy: 'round-robin',
        maxEndpoints: 5,
    };
    const config: ClientConfig = {
        allowAbsoluteUrls: false,
        responseEncoding: 'latin1',
        security: { profile },
        auth: { username: 'user', password: 'pass' },
        idempotencyKey: 'request-1',
        egressPolicy,
        serviceDiscovery,
        tls: {
            servername: 'api.example.com',
            certificatePins: [{ hostname: 'api.example.com', sha256: 'a'.repeat(64) }],
        },
        resilience: {
            retryMethods: ['GET', 'HEAD'],
            retryBudget: {
                maxRetries: 10,
                windowMs: 60_000,
                scope: 'origin',
                namespace: 'types',
                store: { consume: () => true },
            },
            circuitBreakerStorage: {
                store: {
                    get: () => undefined,
                    set: () => undefined,
                },
                namespace: 'types',
            },
            adaptiveConcurrency: { enabled: true, initialLimit: 10, maxLimit: 50 },
        },
        beforeRedirect(context) {
            assert.equal(typeof context.toURL, 'string');
        },
        transitional: { clarifyTimeoutError: true },
        maxRate: [1024, 2048],
        socketPath: '/var/run/docker.sock',
    };

    assert.equal(config.allowAbsoluteUrls, false);
    assert.equal(config.responseEncoding, 'latin1');
    assert.equal(config.security?.profile, 'strict');
    assert.equal(config.auth?.username, 'user');
    assert.equal(config.idempotencyKey, 'request-1');
    assert.equal(config.egressPolicy?.mode, 'webhook-target');
    assert.equal(config.serviceDiscovery?.strategy, 'round-robin');
    assert.equal(config.tls?.servername, 'api.example.com');
    assert.equal(migrationProfile, 'balanced');
    assert.equal(config.resilience?.retryBudget?.maxRetries, 10);
    assert.equal(config.resilience?.retryBudget?.scope, 'origin');
    assert.equal(config.resilience?.circuitBreakerStorage?.namespace, 'types');
    assert.equal(config.resilience?.adaptiveConcurrency?.enabled, true);
    assert.equal(config.transitional?.clarifyTimeoutError, true);
    assert.deepEqual(config.maxRate, [1024, 2048]);
    assert.equal(config.socketPath, '/var/run/docker.sock');
});
