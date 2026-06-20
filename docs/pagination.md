---
title: Pagination
parent: Guides
nav_order: 8
---

# Pagination

`api.paginate(url, options?)` returns an **async generator** that walks paged endpoints for you, yielding one page at a time. It supports four continuation strategies, so it adapts to most REST pagination shapes without custom loop code.

```ts
for await (const page of api.paginate<User[]>('/users')) {
  console.log(page.page, page.data.length);
  // page.data     -> items at `dataPath`
  // page.page     -> 1-based page number
  // page.response -> the full NeutrxResponse for this page
}
```

Each yielded value is a `PaginationPage<TData>`:

```ts
interface PaginationPage<TData> {
  readonly data: TData;            // value dug out at `dataPath`
  readonly page: number;           // 1-based
  readonly response: NeutrxResponse;
}
```

## Strategies

Pick the `strategy` that matches how your API signals "there is a next page". Default is `has-more` (backward compatible).

| Strategy | Stops when | Key options |
| --- | --- | --- |
| `has-more` (default) | the boolean at `hasMorePath` is falsy | `hasMorePath` |
| `total-count` | items seen ≥ the number at `totalPath` | `totalPath` |
| `cursor` | the value at `nextCursorPath` is missing/empty | `nextCursorPath`, `cursorParam` |
| `link-header` | no `rel="next"` in the `Link` response header | — |

### has-more

```ts
// { data: [...], hasMore: true }
for await (const { data } of api.paginate('/items', { strategy: 'has-more', hasMorePath: 'hasMore' })) {}
```

### total-count

```ts
// { data: [...], total: 1280 }
for await (const { data } of api.paginate('/items', { strategy: 'total-count', totalPath: 'total' })) {}
```

### cursor

The next cursor from the response is sent back as `cursorParam` on the following request.

```ts
// { data: [...], nextCursor: "eyJpZCI6MTAwfQ" }
for await (const { data } of api.paginate('/items', {
  strategy: 'cursor',
  nextCursorPath: 'nextCursor',
  cursorParam: 'cursor',
})) {}
```

### link-header

Follows the URL in the `Link: <...>; rel="next"` response header (GitHub-style).

```ts
for await (const { data } of api.paginate('/repos/x/y/issues', { strategy: 'link-header' })) {}
```

## Options

```ts
interface PaginationOptions {
  strategy?: 'has-more' | 'total-count' | 'cursor' | 'link-header'; // default 'has-more'
  pageParam?: string;     // query param for page number (default 'page')
  limitParam?: string;    // query param for page size (default 'limit')
  pageSize?: number;      // default 20
  dataPath?: string;      // dotted path to the items array (default 'data')
  hasMorePath?: string;   // has-more (default 'hasMore')
  totalPath?: string;     // total-count (default 'total')
  nextCursorPath?: string; // cursor (default 'nextCursor')
  cursorParam?: string;   // cursor (default 'cursor')
  maxPages?: number;      // hard cap (default unlimited)
}
```

`dataPath`, `hasMorePath`, `totalPath`, and `nextCursorPath` are **dotted paths** — e.g. `dataPath: 'result.items'` reads `response.data.result.items`.

## Patterns

Collect everything (mind memory on large sets):

```ts
const all: User[] = [];
for await (const page of api.paginate<User[]>('/users', { pageSize: 100 })) {
  all.push(...page.data);
}
```

Stop early — just `break`:

```ts
for await (const page of api.paginate<User[]>('/users')) {
  if (page.data.some(u => u.id === target)) break; // generator stops, no extra requests
}
```

Bound the walk with `maxPages` to avoid runaway loops against a misbehaving API:

```ts
api.paginate('/users', { maxPages: 50 });
```

> Available on both `NeutrxClient` (Node) and `BrowserClient` (browser) with identical behavior.
