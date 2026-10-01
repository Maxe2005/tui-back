import { describe, expect, it } from 'vitest';
import type { Route } from '../../../../../core/ports/route-scanner.js';
import {
  addRequestRow,
  bodyTreeKey,
  buildFireRequest,
  defaultRequestSection,
  exampleToText,
  extractPathParamNames,
  formatByteSize,
  missingRequiredParams,
  nextRequestSection,
  removeRequestRow,
  resolveFireBlock,
  seedRequestDraft,
  setRequestRowValue,
  substitutePathParams,
  type RequestDraft,
} from './routes-request.logic.js';

const USER_ROUTE: Route = {
  method: 'PATCH',
  path: '/orgs/{orgId}/users/{id}',
  parameters: [
    { name: 'id', in: 'path', required: true, example: 42 },
    { name: 'verbose', in: 'query', required: false, example: true },
    { name: 'X-Tenant', in: 'header', required: true },
  ],
  bodyContentType: 'application/json',
  bodyExample: { name: 'x' },
};

describe('seedRequestDraft', () => {
  it('seeds path params in path order (all required, pre-filled from the scanner) plus query/header rows', () => {
    expect(seedRequestDraft(USER_ROUTE)).toEqual({
      params: [
        { name: 'orgId', value: '', required: true },
        { name: 'id', value: '42', required: true },
      ],
      query: [{ name: 'verbose', value: 'true', required: false }],
      headers: [{ name: 'X-Tenant', value: '', required: true }],
    });
  });

  it('drops a scanner path param absent from the template (it could never block a fire)', () => {
    const draft = seedRequestDraft({ path: '/users', parameters: [{ name: 'ghost', in: 'path', required: true }] });
    expect(draft.params).toEqual([]);
    expect(missingRequiredParams(draft)).toEqual([]);
  });

  it('seeds an empty draft for a plain GET', () => {
    expect(seedRequestDraft({ path: '/health' })).toEqual({ params: [], query: [], headers: [] });
  });

  it('renders examples as text, never fabricating a missing one', () => {
    expect(exampleToText(undefined)).toBe('');
    expect(exampleToText(null)).toBe('');
    expect(exampleToText('abc')).toBe('abc');
    expect(exampleToText({ a: 1 })).toBe('{"a":1}');
  });

  it('extracts template names in order, deduplicated', () => {
    expect(extractPathParamNames('/a/{x}/b/{y}/{x}')).toEqual(['x', 'y']);
  });
});

describe('fire block', () => {
  it('lists the missing required path params and blocks the fire', () => {
    const draft = seedRequestDraft(USER_ROUTE);
    expect(missingRequiredParams(draft)).toEqual(['orgId']);
    expect(resolveFireBlock(draft, null)).toBe('Missing required: orgId — nothing sent');
  });

  it('blocks on a body validation error once params are filled', () => {
    const draft: RequestDraft = { params: [{ name: 'id', value: '1', required: true }], query: [], headers: [] };
    expect(resolveFireBlock(draft, 'Not a number')).toBe('Fix the body first: Not a number — nothing sent');
    expect(resolveFireBlock(draft, null)).toBeNull();
  });

  it('treats a whitespace-only value as missing', () => {
    expect(missingRequiredParams({ params: [{ name: 'id', value: '  ', required: true }], query: [], headers: [] })).toEqual(['id']);
  });
});

describe('buildFireRequest', () => {
  it('substitutes URL-encoded params, sends non-empty query/headers and the body draft', () => {
    const draft: RequestDraft = {
      params: [
        { name: 'id', value: 'a/b', required: true },
        { name: 'orgId', value: '7', required: true },
      ],
      query: [
        { name: 'verbose', value: 'true', required: false },
        { name: 'empty', value: '', required: false },
      ],
      headers: [{ name: 'X-Tenant', value: '', required: true }],
    };
    expect(buildFireRequest(USER_ROUTE, draft, { name: 'y' })).toEqual({
      path: '/orgs/7/users/a%2Fb',
      options: { query: { verbose: 'true' }, body: { name: 'y' } },
    });
  });

  it('sends no body without a draft, on a route without a body, or on GET', () => {
    const empty: RequestDraft = { params: [], query: [], headers: [] };
    expect(buildFireRequest({ method: 'POST', path: '/x', bodyContentType: 'text/plain' }, empty, undefined).options).toEqual({});
    expect(buildFireRequest({ method: 'POST', path: '/x' }, empty, { a: 1 }).options).toEqual({});
    expect(buildFireRequest({ method: 'get', path: '/x', bodyExample: {} }, empty, { a: 1 }).options).toEqual({});
  });

  it('treats whitespace-only query/header values as empty (not sent)', () => {
    const draft: RequestDraft = { params: [], query: [{ name: 'q', value: '  ', required: false }], headers: [{ name: 'H', value: ' ', required: false }] };
    expect(buildFireRequest({ method: 'GET', path: '/x' }, draft, undefined).options).toEqual({});
  });

  it('substitutes params inside mixed segments', () => {
    expect(substitutePathParams('/files/{name}.json', [{ name: 'name', value: 'a b', required: true }])).toBe('/files/a%20b.json');
  });

  it('leaves an unfilled template segment untouched', () => {
    expect(substitutePathParams('/u/{id}', [])).toBe('/u/{id}');
  });
});

describe('row editing', () => {
  it('adds a row and rejects empty or duplicate names (headers case-insensitively)', () => {
    const rows = [{ name: 'X-Trace', value: '1', required: false }];
    expect(addRequestRow(rows, '  ', true)).toEqual({ ok: false, reason: 'Name cannot be empty' });
    expect(addRequestRow(rows, 'x-trace', true)).toMatchObject({ ok: false });
    expect(addRequestRow(rows, 'x-trace', false)).toMatchObject({ ok: true });
    expect(addRequestRow(rows, 'Accept', true)).toEqual({
      ok: true,
      rows: [...rows, { name: 'Accept', value: '', required: false }],
    });
  });

  it('removes and edits rows by index', () => {
    const rows = [
      { name: 'a', value: '1', required: false },
      { name: 'b', value: '2', required: false },
    ];
    expect(removeRequestRow(rows, 0)).toEqual([{ name: 'b', value: '2', required: false }]);
    expect(setRequestRowValue(rows, 1, 'z')[1]).toEqual({ name: 'b', value: 'z', required: false });
  });
});

describe('sections, keys and size', () => {
  it('cycles sections with wrap', () => {
    expect(nextRequestSection('params', 'next')).toBe('query');
    expect(nextRequestSection('body', 'next')).toBe('params');
    expect(nextRequestSection('params', 'back')).toBe('body');
  });

  it('opens on the first section with content', () => {
    expect(defaultRequestSection(USER_ROUTE, seedRequestDraft(USER_ROUTE))).toBe('params');
    const empty: RequestDraft = { params: [], query: [], headers: [] };
    expect(defaultRequestSection({ bodyExample: {} }, empty)).toBe('body');
    expect(defaultRequestSection({}, empty)).toBe('params');
  });

  it('keys the body tree apart from the response tree', () => {
    expect(bodyTreeKey('POST /x')).not.toBe('POST /x');
  });

  it('formats UTF-8 byte sizes', () => {
    expect(formatByteSize('')).toBe('0 B');
    expect(formatByteSize('é')).toBe('2 B');
    expect(formatByteSize('a'.repeat(1536))).toBe('1.5 KB');
  });
});
