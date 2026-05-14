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
