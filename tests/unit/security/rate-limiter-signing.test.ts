import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';
import type * as RateLimiterModule from '../../../src/security/RateLimiter.js';

const builtEntry = '../../../../dist/esm/index.js';
const rateLimiterEntry = '../../../../dist/esm/security/RateLimiter.js';

void test('RateLimiter enforces token bucket and refills over time', async () => {
    const { RateLimiter } = await import(rateLimiterEntry) as typeof RateLimiterModule;
    const originalNow = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;

    try {
        const limiter = new RateLimiter({
            enabled: true,
            algorithm: 'token_bucket',
            maxRequests: 1,
            windowMs: 1000,
            burstSize: 1,
            perDomain: false,
        });

        limiter.checkLimit('https://api.example.com/a');
        assert.throws(() => limiter.checkLimit('https://api.example.com/b'), /Rate limit exceeded/u);

        now += 1000;
        assert.doesNotThrow(() => limiter.checkLimit('https://api.example.com/c'));
    } finally {
        Date.now = originalNow;
    }
});

void test('RateLimiter enforces sliding window and fixed window policies', async () => {
    const { RateLimiter } = await import(rateLimiterEntry) as typeof RateLimiterModule;
    const originalNow = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;

    try {
        const sliding = new RateLimiter({
            enabled: true,
            algorithm: 'sliding_window',
            maxRequests: 2,
            windowMs: 1000,
            perDomain: false,
        });
        sliding.checkLimit('https://api.example.com/a');
        sliding.checkLimit('https://api.example.com/b');
        assert.throws(() => sliding.checkLimit('https://api.example.com/c'), /Rate limit exceeded/u);

        now += 1001;
        assert.doesNotThrow(() => sliding.checkLimit('https://api.example.com/d'));

        const fixed = new RateLimiter({
            enabled: true,
            algorithm: 'fixed_window',
            maxRequests: 1,
            windowMs: 1000,
            perDomain: false,
        });
        fixed.checkLimit('https://api.example.com/a');
        assert.throws(() => fixed.checkLimit('https://api.example.com/b'), /Rate limit exceeded/u);

        now += 1000;
        assert.doesNotThrow(() => fixed.checkLimit('https://api.example.com/c'));
    } finally {
        Date.now = originalNow;
    }
});

void test('request signing adds deterministic timestamp and HMAC headers', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000;

    try {
        const secret = 'signing-secret';
        const api = Neutrx.create({
            baseURL: 'https://api.example.com',
            adapter: config => ({
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({
                    timestamp: config.headers['X-Neutrx-Timestamp'],
                    signature: config.headers['X-Neutrx-Signature'],
                })),
                config,
            }),
        }).enableRequestSigning(secret);

        const response = await api.post('/signed', { ok: true });
        const expected = crypto
            .createHmac('sha256', secret)
            .update('POST:https://api.example.com/signed:1700000000000:{"ok":true}')
            .digest('hex');

        assert.deepEqual(response.data, {
            timestamp: '1700000000000',
            signature: expected,
        });
    } finally {
        Date.now = originalNow;
    }
});
