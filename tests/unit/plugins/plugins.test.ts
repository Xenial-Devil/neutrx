import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/esm/index.js';

void test('MockPlugin returns registered responses', async () => {
    const { default: Neutrx, MockPlugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({ baseURL: 'https://api.example.com' });
    api.use(MockPlugin);
    api.mock?.enable().register('/mocked', { data: { ok: true } });

    const response = await api.get('/mocked');
    assert.deepEqual(response.data, { ok: true });
});

void test('GraphQLPlugin unwraps GraphQL data and surfaces errors', async () => {
    const { default: Neutrx, GraphQLPlugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(config.url.endsWith('/bad')
                ? JSON.stringify({ errors: [{ message: 'bad query' }] })
                : JSON.stringify({ data: { viewer: { id: '1' } }, extensions: { cost: 1 } })),
            config,
        }),
    });
    api.use(GraphQLPlugin);

    const response = await api.gql?.('https://api.example.com/graphql', '{ viewer { id } }');
    assert.deepEqual(response?.data, { viewer: { id: '1' } });
    assert.deepEqual(response?.extensions, { cost: 1 });
    await assert.rejects(api.gql?.('https://api.example.com/bad', '{ bad }') ?? Promise.resolve(), /GraphQL Error/u);
});

void test('OAuth2Plugin fetches token and injects bearer auth', async () => {
    const { default: Neutrx, OAuth2Plugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(config.url.endsWith('/token')
                ? JSON.stringify({ access_token: 'token-1', expires_in: 3600 })
                : JSON.stringify({ authorization: config.headers.Authorization })),
            config,
        }),
    });
    api.use(OAuth2Plugin);
    api.configureOAuth2?.({ tokenURL: 'https://auth.example.com/token' });

    const response = await api.get('https://api.example.com/secure');
    assert.deepEqual(response.data, { authorization: 'Bearer token-1' });
});

void test('OAuth2Plugin refreshes tokens inside the refresh window', async () => {
    const { default: Neutrx, OAuth2Plugin } = await import(builtEntry) as typeof PackageEntry;
    let tokenCalls = 0;
    const api = Neutrx.create({
        performance: { enableCaching: false },
        adapter: config => {
            if (config.url.endsWith('/token')) {
                tokenCalls += 1;
                return {
                    status: 200,
                    statusText: 'OK',
                    headers: { 'content-type': 'application/json' },
                    data: Buffer.from(JSON.stringify({ access_token: `token-${tokenCalls}`, expires_in: 1 })),
                    config,
                };
            }

            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ authorization: config.headers.Authorization })),
                config,
            };
        },
    });
    api.use(OAuth2Plugin);
    api.configureOAuth2?.({ tokenURL: 'https://auth.example.com/token' });

    const first = await api.get('https://api.example.com/secure');
    const second = await api.get('https://api.example.com/secure');

    assert.equal(tokenCalls, 2);
    assert.deepEqual(first.data, { authorization: 'Bearer token-1' });
    assert.deepEqual(second.data, { authorization: 'Bearer token-2' });
});

void test('ValidationPlugin validates and transforms request and response data', async () => {
    const { default: Neutrx, NeutrxValidationError, ValidationPlugin } = await import(builtEntry) as typeof PackageEntry;
    let seenName: string | undefined;
    const api = Neutrx.create({
        adapter: config => {
            seenName = typeof config.data === 'object' && config.data !== null && 'name' in config.data
                ? String((config.data as { readonly name: unknown }).name)
                : undefined;
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ id: 123, name: seenName })),
                config,
            };
        },
    });
    api.use(ValidationPlugin);
    api.configureValidation?.({
        request: {
            parse(value) {
                if (!isRecord(value) || typeof value.name !== 'string' || value.name.trim() === '') {
                    throw Object.assign(new Error('name is required'), {
                        issues: [{ path: ['name'], message: 'name is required', code: 'required' }],
                    });
                }
                return { ...value, name: value.name.trim() };
            },
        },
        response: {
            safeParse(value) {
                if (!isRecord(value) || typeof value.id !== 'number') {
                    return { success: false, issues: [{ path: ['id'], message: 'id must be number' }] };
                }
                return { success: true, data: { ...value, id: String(value.id) } };
            },
        },
    });

    await assert.rejects(
        api.post('https://api.example.com/users', { name: '   ' }),
        error => error instanceof NeutrxValidationError
            && error.phase === 'request'
            && error.issues[0]?.path?.[0] === 'name'
    );

    const response = await api.post('https://api.example.com/users', { name: ' Ada ' });
    assert.equal(seenName, 'Ada');
    assert.deepEqual(response.data, { id: '123', name: 'Ada' });
});

void test('ValidationPlugin supports TypeBox-style Check and Errors per request', async () => {
    const { default: Neutrx, NeutrxValidationError, ValidationPlugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({ ok: false })),
            config,
        }),
    });
    api.use(ValidationPlugin);

    await assert.rejects(
        api.get('https://api.example.com/status', {
            validation: {
                response: {
                    Check(value: unknown) {
                        return isRecord(value) && value.ok === true;
                    },
                    Errors() {
                        return [{ path: ['ok'], message: 'ok must be true', code: 'literal' }];
                    },
                },
            },
        }),
        error => error instanceof NeutrxValidationError
            && error.phase === 'response'
            && error.issues[0]?.code === 'literal'
    );
});

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
