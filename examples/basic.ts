import neutrx from '../src/index.js';

const api = neutrx.create({
    baseURL: 'https://api.example.com',
    timeout: 10_000,
    security: { profile: 'standard' },
});

export async function fetchUsers(): Promise<unknown> {
    const response = await api.get('/users', {
        params: { page: 1 },
    });
    return response.data;
}
