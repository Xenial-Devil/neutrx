import { NeutrxHeaders } from '../src/index.js';
import api from './api.js';

api.mock?.enable().register('/users/new', {
    status: 201,
    data: { id: 2, name: 'Alan Turing' },
}).register('/users/2', {
    status: 200,
    data: { id: 2, name: 'Grace Hopper' },
}).register('/users', {
    status: 200,
    data: [{ id: 1, name: 'Ada Lovelace' }],
    delay: 50,
}).register('/health', {
    status: 204,
    data: null,
}).register('/products', {
    status: 200,
    data: [{ id: 1, name: 'Keyboard' }],
}).register('/orders', {
    status: 200,
    data: [{ id: 1, total: 42 }],
}).register('/token', {
    status: 200,
    data: { access_token: 'mock-token', expires_in: 3600 },
}).register('/graphql', {
    status: 200,
    data: { data: { user: { id: '123', name: 'Ada Lovelace' } } },
});

async function run(): Promise<void> {
    const requestHeaders = new NeutrxHeaders()
        .setAccept('application/json')
        .setBearerAuth('example-token');

    const users = await api.get<readonly { readonly id: number; readonly name: string }[]>('/users');
    console.log(users.data);

    const created = await api.post<{ readonly id: number; readonly name: string }>('/users/new', { name: 'Alan Turing' }, {
        headers: requestHeaders.toJSON(),
    });
    console.log(created.data);
    console.log(requestHeaders.redactSensitive());

    const replaced = await api.put<{ readonly id: number; readonly name: string }>('/users/2', { name: 'Grace Hopper' });
    console.log(replaced.data);

    const updated = await api.patch<{ readonly id: number; readonly name: string }>('/users/2', { name: 'Grace Hopper' });
    console.log(updated.data);

    const removed = await api.delete<{ readonly id: number; readonly name: string }>('/users/2');
    console.log(removed.data);

    const healthOptions = await api.options<null>('/health');
    console.log(healthOptions.status);

    const healthHead = await api.head<null>('/health');
    console.log(healthHead.status);

    const browserStyle = await api.get('/users', {
        adapter: 'fetch',
        credentials: 'include',
        xsrfCookieName: 'XSRF-TOKEN',
        xsrfHeaderName: 'X-XSRF-TOKEN',
        withXSRFToken: true,
        responseType: 'json',
    });
    console.log(browserStyle.status);

    const http2Ready = await api.get('/users', {
        httpVersion: '2',
        http2Options: {
            sessionTimeout: 30_000,
            maxSessions: 4,
        },
    });
    console.log(http2Ready.status);

    const formCreated = await api.post('/users/new', {
        user: {
            name: 'Katherine Johnson',
            roles: ['admin', 'analyst'],
        },
    }, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
        formSerializer: {
            dots: true,
            indexes: true,
            maxDepth: 4,
        },
    });
    console.log(formCreated.status);

    const { results, errors } = await api.concurrent([
        { method: 'GET', url: '/users' },
        { method: 'GET', url: '/products' },
        () => ({ method: 'GET', url: '/orders' }),
    ]);
    console.log(results.length, errors.filter(Boolean).length);

    if (api.gql) {
        const graph = await api.gql<{ readonly user: { readonly id: string; readonly name: string } }>(
            'https://api.example.com/graphql',
            'query GetUser($id: ID!) { user(id: $id) { id name } }',
            { id: '123' }
        );
        console.log(graph.data);
    }

    console.log(api.getMetrics());
}

run().catch((error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    console.error(normalized.message);
});
