import { NeutrxSecurityError } from './NeutrxError.js';
import type { FormSerializerOptions } from '../types.js';

const DANGEROUS_FORM_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

type FormContainer = Record<string, unknown> | unknown[];

/**
 * Build a {@link FormData} instance from a plain object, honouring neutrx's
 * bracket/dot path and array index policies. Internal worker shared by the body
 * serializer and the public {@link toFormData} helper.
 */
export function buildFormData(data: Record<string, unknown>, options: FormSerializerOptions = {}, envFormData?: typeof FormData): FormData {
    const FormDataCtor = envFormData ?? (typeof FormData !== 'undefined' ? FormData : undefined);
    if (!FormDataCtor) {
        throw new NeutrxSecurityError('FormData is unavailable in this runtime', { code: 'FORMDATA_UNAVAILABLE' });
    }
    const form = new FormDataCtor();
    appendFormValue(form, '', data, options, new WeakSet<object>(), 0);
    return form;
}

/**
 * Axios-compatible `toFormData(obj, formData?, options?)`. Serializes a plain
 * object into FormData; when an existing FormData is supplied, entries are
 * appended to it and the same instance is returned.
 */
export function toFormData(
    obj: Record<string, unknown>,
    formData?: FormData | FormSerializerOptions,
    options?: FormSerializerOptions
): FormData {
    if (typeof FormData !== 'undefined' && formData instanceof FormData) {
        const produced = buildFormData(obj, options ?? {});
        for (const [name, value] of produced.entries()) {
            formData.append(name, value);
        }
        return formData;
    }
    return buildFormData(obj, (formData as FormSerializerOptions | undefined) ?? {});
}

/**
 * Axios-compatible `formDataToJSON`. Reconstructs a nested object from FormData
 * entries using bracket/index path notation. Prototype-pollution keys are
 * dropped (security-positive vs axios, which only guards `__proto__`).
 */
export function formDataToJSON(formData: FormData | null | undefined): Record<string, unknown> | null {
    if (!formData || typeof formData.entries !== 'function') return null;
    const result: Record<string, unknown> = {};
    for (const [name, value] of formData.entries()) {
        setFormPath(result, parsePropPath(name), value);
    }
    return result;
}

/** Alias for {@link formDataToJSON} matching axios's exported `formToJSON` name. */
export const formToJSON = formDataToJSON;

/** Flatten a plain object into `application/x-www-form-urlencoded` entry pairs. */
export function toFormEntries(data: Record<string, unknown>, options: FormSerializerOptions = {}): Array<[string, string]> {
    const params: Array<[string, string]> = [];
    flattenFormEntries(params, '', data, options, new WeakSet<object>(), 0);
    return params;
}

export function isBlobLike(value: unknown): value is Blob {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly arrayBuffer?: unknown }).arrayBuffer === 'function'
        && typeof (value as { readonly size?: unknown }).size === 'number'
        && typeof (value as { readonly type?: unknown }).type === 'string';
}

export function isFileListLike(value: unknown): value is Iterable<Blob> & { readonly length: number } {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly length?: unknown }).length === 'number'
        && typeof (value as { readonly item?: unknown }).item === 'function'
        && typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

function appendFormValue(
    form: FormData,
    path: string,
    value: unknown,
    options: FormSerializerOptions,
    seen: WeakSet<object>,
    depth: number
): void {
    assertDepth(depth, options.maxDepth);
    if (value == null) return;
    if (isBlobLike(value)) {
        form.append(path, value);
        return;
    }
    if (isFileListLike(value)) {
        Array.from(value).forEach((file, index) => form.append(arrayKey(path, index, options), file));
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => appendFormValue(form, arrayKey(path, index, options), item, options, seen, depth + 1));
        return;
    }
    if (typeof value === 'object') {
        assertNotCircular(value, seen);
        for (const [key, child] of Object.entries(value)) {
            appendFormValue(form, joinKey(path, key, options), child, options, seen, depth + 1);
        }
        seen.delete(value);
        return;
    }
    form.append(path, scalarToString(value));
}

function flattenFormEntries(
    result: Array<[string, string]>,
    path: string,
    value: unknown,
    options: FormSerializerOptions,
    seen: WeakSet<object>,
    depth: number
): void {
    assertDepth(depth, options.maxDepth);
    if (value == null) return;
    if (isBlobLike(value) || isFileListLike(value)) {
        result.push([path, '[binary]']);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => flattenFormEntries(result, arrayKey(path, index, options), item, options, seen, depth + 1));
        return;
    }
    if (typeof value === 'object') {
        assertNotCircular(value, seen);
        for (const [key, child] of Object.entries(value)) {
            flattenFormEntries(result, joinKey(path, key, options), child, options, seen, depth + 1);
        }
        seen.delete(value);
        return;
    }
    result.push([path, scalarToString(value)]);
}

export function assertDepth(depth: number, maxDepth = 20): void {
    if (depth > maxDepth) throw new NeutrxSecurityError('Form body depth limit exceeded', { code: 'FORM_DEPTH_EXCEEDED' });
}

export function assertNotCircular(value: object, seen: WeakSet<object>): void {
    if (seen.has(value)) throw new NeutrxSecurityError('Circular body reference detected', { code: 'BODY_CIRCULAR_REFERENCE' });
    seen.add(value);
}

function joinKey(parent: string, key: string, options: FormSerializerOptions): string {
    if (!parent) return key;
    return options.dots ? `${parent}.${key}` : `${parent}[${key}]`;
}

function arrayKey(parent: string, index: number, options: FormSerializerOptions): string {
    if (options.indexes === true) return `${parent}[${index}]`;
    if (options.indexes === null) return parent;
    return `${parent}[]`;
}

function scalarToString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (typeof value === 'symbol') return value.description ?? '';
    if (typeof value === 'function') return value.name || '[function]';
    return JSON.stringify(value) ?? '';
}

/** Tokenize an axios form key (`a[b][0]`, `tags[]`) into path segments. */
function parsePropPath(name: string): string[] {
    const tokens: string[] = [];
    const matcher = /\w+|\[\]/g;
    let match: RegExpExecArray | null = matcher.exec(name);
    while (match !== null) {
        tokens.push(match[0] === '[]' ? '' : match[0]);
        match = matcher.exec(name);
    }
    return tokens.length > 0 ? tokens : [name];
}

function setFormPath(target: Record<string, unknown>, tokens: readonly string[], value: string | Blob): void {
    let index = 0;

    const build = (node: FormContainer): boolean => {
        const token = tokens[index++];
        if (token === undefined) return true;
        let name: string | number = token;
        if (DANGEROUS_FORM_KEYS.has(token)) return true;

        const numeric = name !== '' && Number.isFinite(Number(name));
        const last = index >= tokens.length;
        if (name === '' && Array.isArray(node)) name = node.length;

        const container = node as Record<string | number, unknown>;
        if (last) {
            if (Object.prototype.hasOwnProperty.call(container, name)) {
                const existing = container[name];
                container[name] = Array.isArray(existing) ? [...(existing as unknown[]), value] : [existing, value];
            } else {
                container[name] = value;
            }
            return !numeric;
        }

        let child = container[name];
        if (child === null || typeof child !== 'object') {
            child = [];
            container[name] = child;
        }
        const result = build(child as FormContainer);
        if (result && Array.isArray(child)) {
            container[name] = arrayToObject(child);
        }
        return !numeric;
    };

    build(target);
}

function arrayToObject(arr: readonly unknown[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    const source = arr as unknown as Record<string, unknown>;
    for (const key of Object.keys(arr)) {
        obj[key] = source[key];
    }
    return obj;
}
