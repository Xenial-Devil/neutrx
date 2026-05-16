import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientConfig, SecurityProfile } from '../../src/index.js';

void test('public config types expose Node 22 security and retry options', () => {
    const profile: SecurityProfile = 'strict';
    const config: ClientConfig = {
        security: { profile },
        resilience: {
            retryMethods: ['GET', 'HEAD'],
            retryBudget: { maxRetries: 10, windowMs: 60_000 },
        },
    };

    assert.equal(config.security?.profile, 'strict');
    assert.equal(config.resilience?.retryBudget?.maxRetries, 10);
});
