import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientConfig, SecurityProfile, SecurityProfileInput } from '../../src/index.js';

void test('public config types expose Node 22 security and retry options', () => {
    const profile: SecurityProfile = 'strict';
    const migrationProfile: SecurityProfileInput = 'balanced';
    const config: ClientConfig = {
        security: { profile },
        resilience: {
            retryMethods: ['GET', 'HEAD'],
            retryBudget: { maxRetries: 10, windowMs: 60_000 },
        },
        maxRate: [1024, 2048],
    };

    assert.equal(config.security?.profile, 'strict');
    assert.equal(migrationProfile, 'balanced');
    assert.equal(config.resilience?.retryBudget?.maxRetries, 10);
    assert.deepEqual(config.maxRate, [1024, 2048]);
});
