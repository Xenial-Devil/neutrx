import neutrx from '../src/index.js';

export const paymentsApi = neutrx.create({
    baseURL: 'https://payments.example.com',
    timeout: 5_000,
    maxContentLength: 5 * 1024 * 1024,
    maxBodyLength: 1024 * 1024,
    security: {
        profile: 'strict',
        allowedHosts: ['payments.example.com'],
        enforceHTTPS: true,
        blockMetadataIPs: true,
    },
});

paymentsApi.interceptors.request.use(config => ({
    ...config,
    headers: {
        ...config.headers,
        'X-Service': 'billing',
    },
}));

export async function getInvoice(invoiceId: string): Promise<unknown> {
    const response = await paymentsApi.get(`/invoices/${encodeURIComponent(invoiceId)}`);
    return response.data;
}
