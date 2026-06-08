import { NeutrxValidationError } from './NeutrxError.js';
import type {
    InternalRequestConfig,
    ParsedResponseData,
    ValidationIssue,
    ValidationSchema,
} from '../types.js';

export type ValidationOutcome = { readonly changed: boolean; readonly value?: unknown };

export async function validateValue<TInput>(
    schema: ValidationSchema<unknown, TInput>,
    value: TInput,
    phase: 'request' | 'response',
    config: InternalRequestConfig
): Promise<ValidationOutcome> {
    try {
        return normalizeValidationResult(await runSchema(schema, value), schema);
    } catch (error: unknown) {
        throw validationError(phase, config, error);
    }
}

export async function validateResponseData<TData extends ParsedResponseData>(
    data: TData,
    config: InternalRequestConfig
): Promise<TData> {
    if (!config.schema) return data;
    const result = await validateValue(config.schema, data, 'response', config);
    return result.changed ? result.value as TData : data;
}

async function runSchema<TInput>(schema: ValidationSchema<unknown, TInput>, value: TInput): Promise<unknown> {
    if (typeof schema === 'function') return schema(value);
    if ('safeParse' in schema && typeof schema.safeParse === 'function') return schema.safeParse(value);
    if ('parse' in schema && typeof schema.parse === 'function') return schema.parse(value);
    if ('validate' in schema && typeof schema.validate === 'function') return schema.validate(value);
    if ('Check' in schema && typeof schema.Check === 'function') {
        if (schema.Check(value)) return true;
        return typeBoxIssues(schema, value);
    }
    throw new Error('Unsupported validation schema');
}

function normalizeValidationResult<TInput>(result: unknown, schema: ValidationSchema<unknown, TInput>): ValidationOutcome {
    if (result === undefined || result === true) return { changed: false };
    if (result === false) throw new ValidationFailureSignal(issuesFromUnknown(errorsFromSchema(schema)));
    if (Array.isArray(result) && result.every(isValidationIssueLike)) throw new ValidationFailureSignal(issuesFromUnknown(result));
    if (isValidationIssueLike(result)) throw new ValidationFailureSignal(issuesFromUnknown([result]));

    if (result !== null && typeof result === 'object' && 'success' in result) {
        const parsed = result as { readonly success?: unknown; readonly data?: unknown; readonly error?: unknown; readonly issues?: unknown };
        if (parsed.success === true) return 'data' in parsed ? { changed: true, value: parsed.data } : { changed: false };
        throw new ValidationFailureSignal(issuesFromUnknown(parsed.issues ?? parsed.error));
    }

    return { changed: true, value: result };
}

function validationError(phase: 'request' | 'response', config: InternalRequestConfig, error: unknown): NeutrxValidationError {
    if (error instanceof NeutrxValidationError) return error;
    const issues = error instanceof ValidationFailureSignal ? error.issues : issuesFromUnknown(error);
    return new NeutrxValidationError(phase, issues, {
        url: config.url,
        method: config.method,
        requestId: config.requestId,
        ...(config.traceContext ? { traceContext: config.traceContext } : {}),
        cause: error,
    });
}

function issuesFromUnknown(value: unknown): readonly ValidationIssue[] {
    if (Array.isArray(value)) return value.flatMap(item => issuesFromUnknown(item));
    if (value instanceof Error) {
        const error = value as Error & { readonly issues?: unknown; readonly errors?: unknown };
        if (error.issues !== undefined) return issuesFromUnknown(error.issues);
        if (error.errors !== undefined) return issuesFromUnknown(error.errors);
        return [{ message: value.message }];
    }
    if (isValidationIssueLike(value)) return [toIssue(value)];
    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (Array.isArray(record.issues)) return issuesFromUnknown(record.issues);
        if (Array.isArray(record.errors)) return issuesFromUnknown(record.errors);
        const path = pathFromUnknown(record.path ?? record.instancePath);
        return [{
            message: stringifyIssue(record.message ?? record.error ?? 'Validation failed'),
            ...(path ? { path } : {}),
            ...(typeof record.code === 'string' ? { code: record.code } : {}),
        }];
    }
    return [{ message: stringifyIssue(value ?? 'Validation failed') }];
}

function typeBoxIssues<TInput>(schema: ValidationSchema<unknown, TInput>, value: TInput): readonly ValidationIssue[] {
    if (!('Errors' in schema) || typeof schema.Errors !== 'function') return [{ message: 'Validation failed' }];
    return issuesFromUnknown([...schema.Errors(value)]);
}

function errorsFromSchema<TInput>(schema: ValidationSchema<unknown, TInput>): unknown {
    return typeof schema === 'function' || 'errors' in schema ? schema.errors : undefined;
}

function isValidationIssueLike(value: unknown): value is { readonly message: unknown; readonly path?: unknown; readonly code?: unknown } {
    return value !== null
        && typeof value === 'object'
        && 'message' in value
        && typeof (value as { readonly message?: unknown }).message === 'string';
}

function toIssue(value: { readonly message: unknown; readonly path?: unknown; readonly code?: unknown }): ValidationIssue {
    const path = pathFromUnknown(value.path);
    return {
        ...(path ? { path } : {}),
        message: stringifyIssue(value.message),
        ...(typeof value.code === 'string' ? { code: value.code } : {}),
    };
}

function pathFromUnknown(path: unknown): readonly (string | number)[] | undefined {
    if (Array.isArray(path)) {
        const next = path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number');
        return next.length > 0 ? next : undefined;
    }
    if (typeof path === 'string' && path) {
        const normalized = path.startsWith('/') ? path.slice(1).replace(/\//g, '.') : path;
        return normalized ? normalized.split('.').filter(Boolean) : undefined;
    }
    return undefined;
}

function stringifyIssue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    try {
        return JSON.stringify(value) ?? 'Validation failed';
    } catch {
        return String(value);
    }
}

class ValidationFailureSignal extends Error {
    readonly issues: readonly ValidationIssue[];

    constructor(issues: readonly ValidationIssue[]) {
        super('Validation failed');
        this.name = 'ValidationFailureSignal';
        this.issues = issues;
    }
}
