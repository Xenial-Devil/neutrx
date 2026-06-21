import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';
import type * as RateLimiterModule from '../../../src/security/RateLimiter.js';

const builtEntry = '../../../../dist/index.mjs';
const rateLimiterEntry = '../../../../dist/security/RateLimiter.mjs';

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

        await limiter.checkLimit('https://api.example.com/a');
        await assert.rejects(limiter.checkLimit('https://api.example.com/b'), /Rate limit exceeded/u);

        now += 1000;
        await limiter.checkLimit('https://api.example.com/c');
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
        await sliding.checkLimit('https://api.example.com/a');
        await sliding.checkLimit('https://api.example.com/b');
        await assert.rejects(sliding.checkLimit('https://api.example.com/c'), /Rate limit exceeded/u);

        now += 1001;
        await sliding.checkLimit('https://api.example.com/d');

        const fixed = new RateLimiter({
            enabled: true,
            algorithm: 'fixed_window',
            maxRequests: 1,
            windowMs: 1000,
            perDomain: false,
        });
        await fixed.checkLimit('https://api.example.com/a');
        await assert.rejects(fixed.checkLimit('https://api.example.com/b'), /Rate limit exceeded/u);

        now += 1000;
        await assert.doesNotReject(fixed.checkLimit('https://api.example.com/c'));
    } finally {
        Date.now = originalNow;
    }
});

void test('request signing adds timestamp, per-request nonce and HMAC over the nonce', async () => {
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
                    nonce: config.headers['X-Neutrx-Nonce'],
                    signature: config.headers['X-Neutrx-Signature'],
                })),
                config,
            }),
        }).enableRequestSigning(secret);

        const first = await api.post('/signed', { ok: true }) as { data: { timestamp: string; nonce: string; signature: string } };

        // Nonce must be present and a 16-byte hex string.
        assert.match(first.data.nonce, /^[0-9a-f]{32}$/u);

        // Signature must cover the nonce (replay protection).
        const expected = crypto
            .createHmac('sha256', secret)
            .update(`POST:https://api.example.com/signed:1700000000000:${first.data.nonce}:{"ok":true}`)
            .digest('hex');
        assert.equal(first.data.signature, expected);
        assert.equal(first.data.timestamp, '1700000000000');

        // Two identical requests at the same timestamp must produce different nonces and signatures.
        const second = await api.post('/signed', { ok: true }) as { data: { nonce: string; signature: string } };
        assert.notEqual(first.data.nonce, second.data.nonce);
        assert.notEqual(first.data.signature, second.data.signature);
    } finally {
        Date.now = originalNow;
    }
});
