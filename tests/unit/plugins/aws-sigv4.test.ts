import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';

// Official AWS SigV4 test-suite `get-vanilla` vector (botocore aws4_testsuite).
const SUITE_CREDENTIALS = {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};
const SUITE_DATE = (): Date => new Date('2015-08-30T12:36:00Z');
const GET_VANILLA_AUTH =
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, '
    + 'SignedHeaders=host;x-amz-date, '
    + 'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31';

void test('createAwsSigV4Plugin matches the official AWS SigV4 get-vanilla vector', async () => {
    const { default: Neutrx, createAwsSigV4Plugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({ adapter: snapshotAdapter });
    api.use(createAwsSigV4Plugin({
        region: 'us-east-1',
        service: 'service',
        credentials: SUITE_CREDENTIALS,
        now: SUITE_DATE,
    }));

    const response = await api.get('https://example.amazonaws.com/');
    const captured = response.data as unknown as CapturedRequest;

    assert.equal(captured.authorization, GET_VANILLA_AUTH);
    assert.equal(captured.amzDate, '20150830T123600Z');
    assert.equal(captured.host, 'example.amazonaws.com');
});

void test('createAwsSigV4Plugin signs the session token and JSON body for s3', async () => {
    const { default: Neutrx, createAwsSigV4Plugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({ adapter: snapshotAdapter });
    api.use(createAwsSigV4Plugin({
        region: 'us-east-1',
        service: 's3',
        credentials: { ...SUITE_CREDENTIALS, sessionToken: 'SESSIONTOKEN==' },
        now: SUITE_DATE,
    }));

    const body = { hello: 'world' };
    const response = await api.post('https://bucket.s3.amazonaws.com/key', body);
    const captured = response.data as unknown as CapturedRequest;
    const expectedHash = crypto.createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');

    assert.equal(captured.securityToken, 'SESSIONTOKEN==');
    assert.equal(captured.contentSha256, expectedHash);
    assert.match(captured.authorization ?? '', /\/s3\/aws4_request/u);
    assert.match(
        captured.authorization ?? '',
        /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token/u
    );
});

void test('createAwsSigV4Plugin emits UNSIGNED-PAYLOAD when configured', async () => {
    const { default: Neutrx, createAwsSigV4Plugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({ adapter: snapshotAdapter });
    api.use(createAwsSigV4Plugin({
        region: 'eu-west-1',
        service: 's3',
        credentials: SUITE_CREDENTIALS,
        unsignedPayload: true,
        now: SUITE_DATE,
    }));

    const response = await api.put('https://bucket.s3.amazonaws.com/key', 'raw-bytes');
    const captured = response.data as unknown as CapturedRequest;

    assert.equal(captured.contentSha256, 'UNSIGNED-PAYLOAD');
});

interface CapturedRequest {
    readonly authorization: string | null;
    readonly amzDate: string | null;
    readonly host: string | null;
    readonly securityToken: string | null;
    readonly contentSha256: string | null;
}

function snapshotAdapter(config: PackageEntry.NeutrxRequestConfig): PackageEntry.RawHttpResponse {
    const captured: CapturedRequest = {
        authorization: header(config, 'Authorization'),
        amzDate: header(config, 'X-Amz-Date'),
        host: header(config, 'Host'),
        securityToken: header(config, 'X-Amz-Security-Token'),
        contentSha256: header(config, 'X-Amz-Content-Sha256'),
    };
    return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: Buffer.from(JSON.stringify(captured)),
        config,
    };
}

function header(config: PackageEntry.NeutrxRequestConfig, name: string): string | null {
    const value = config.headers.get(name);
    if (value === undefined || value === false) return null;
    return Array.isArray(value) ? value.join(', ') : String(value);
}
