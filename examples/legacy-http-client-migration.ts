import neutrx, { isNeutrxError } from '../src/index.js';

const api = neutrx.create({
    baseURL: 'https://api.example.com',
    timeout: 10_000,
    security: { profile: 'standard' },
    validateStatus: status => status < 500,
});

const requestInterceptor = api.interceptors.request.use(config => ({
    ...config,
    headers: {
        ...config.headers,
        'X-Request-Source': 'legacy-migration',
    },
}));

api.interceptors.request.eject(requestInterceptor);

export async function createUser(): Promise<unknown> {
    try {
        const response = await api.post('/users', { name: 'Ada Lovelace' }, {
            params: { notify: true },
            transformResponse(data) {
                return data;
            },
        });
        return response.data;
    } catch (error) {
        if (!isNeutrxError(error)) throw error;
        return error.toJSON();
    }
}
