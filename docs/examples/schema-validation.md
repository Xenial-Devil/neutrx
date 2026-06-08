# Schema Validation

Use `schema` to validate and optionally transform parsed response data before a successful response is returned. Neutrx accepts Zod-like `safeParse`, `parse`, `validate`, TypeBox-style `Check/Errors`, or function validators.

```ts
import neutrx, {
  NeutrxValidationError,
  type ResponseValidationSchema,
} from 'neutrx';

type User = {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
};

const userSchema = {
  safeParse(value: unknown) {
    if (
      value !== null
      && typeof value === 'object'
      && !Array.isArray(value)
      && 'id' in value
      && 'name' in value
      && 'active' in value
    ) {
      const record = value as Record<string, unknown>;

      if (
        typeof record.id === 'number'
        && typeof record.name === 'string'
        && typeof record.active === 'boolean'
      ) {
        return {
          success: true as const,
          data: {
            id: String(record.id),
            name: record.name.trim(),
            active: record.active,
          },
        };
      }
    }

    return {
      success: false as const,
      issues: [{ path: ['id'], message: 'user response is invalid' }],
    };
  },
} satisfies ResponseValidationSchema<User>;

const api = neutrx.create({
  baseURL: 'https://api.example.com',
  security: { profile: 'standard' },
});

export async function fetchUser(userId: string): Promise<User> {
  try {
    const response = await api.get(`/users/${encodeURIComponent(userId)}`, {
      schema: userSchema,
    });

    return response.data;
  } catch (error) {
    if (error instanceof NeutrxValidationError) {
      console.error(error.issues);
    }

    throw error;
  }
}
```

Validation failures do not retry.
