import neutrx, {
    NeutrxValidationError,
    type ResponseValidationSchema,
} from '../src/index.js';

type User = {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
};

const userSchema = {
    safeParse(value: unknown) {
        if (
            isRecord(value)
            && typeof value.id === 'number'
            && typeof value.name === 'string'
            && typeof value.active === 'boolean'
        ) {
            return {
                success: true as const,
                data: {
                    id: String(value.id),
                    name: value.name.trim(),
                    active: value.active,
                },
            };
        }

        return {
            success: false as const,
            issues: [
                { path: ['id'], message: 'id must be a number' },
                { path: ['name'], message: 'name must be a string' },
                { path: ['active'], message: 'active must be a boolean' },
            ],
        };
    },
} satisfies ResponseValidationSchema<User>;

const api = neutrx.create({
    baseURL: 'https://api.example.com',
    timeout: 5_000,
    security: { profile: 'standard' },
});

export async function fetchUser(userId: string): Promise<User> {
    const response = await api.get(`/users/${encodeURIComponent(userId)}`, {
        schema: userSchema,
    });

    return response.data;
}

export async function fetchUserWithoutValidation(userId: string) {
    return api.get(`/users/${encodeURIComponent(userId)}`, {
        schema: false,
    });
}

export async function handleValidationFailure(userId: string): Promise<readonly string[]> {
    try {
        await fetchUser(userId);
        return [];
    } catch (error) {
        if (error instanceof NeutrxValidationError) {
            return error.issues.map(issue => `${issue.path?.join('.') ?? '<root>'}: ${issue.message}`);
        }
        throw error;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
