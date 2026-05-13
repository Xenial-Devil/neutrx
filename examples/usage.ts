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
    const users = await api.get<readonly { readonly id: number; readonly name: string }[]>('/users');
    console.log(users.data);

    const created = await api.post<{ readonly id: number; readonly name: string }>('/users/new', { name: 'Alan Turing' });
    console.log(created.data);

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
