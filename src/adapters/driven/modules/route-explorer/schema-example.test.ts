// adapters/driven/modules/route-explorer/schema-example: pure unit tests — $ref resolution and
// skeleton generation, including the bounded/cycle-safe guarantees.
import { describe, expect, it } from 'vitest';
import { dereference, generateExample, resolveLocalRef } from './schema-example.js';

const DOC = {
  components: {
    schemas: {
      Address: { type: 'object', properties: { city: { type: 'string' }, zip: { type: 'integer' } } },
      Status: { type: 'string', enum: ['paid', 'open'] },
      Base: { type: 'object', properties: { id: { type: 'integer' } } },
      Order: {
        allOf: [
          { $ref: '#/components/schemas/Base' },
          {
            type: 'object',
            properties: {
              status: { $ref: '#/components/schemas/Status' },
              address: { $ref: '#/components/schemas/Address' },
              tags: { type: 'array', items: { type: 'string' } },
              paid: { type: 'boolean' },
              note: { type: 'string', example: 'fragile' },
              qty: { type: 'number', default: 3 },
            },
          },
        ],
      },
      Node: { type: 'object', properties: { value: { type: 'string' }, next: { $ref: '#/components/schemas/Node' } } },
      A: { $ref: '#/components/schemas/B' },
      B: { $ref: '#/components/schemas/A' },
    },
  },
};

describe('resolveLocalRef / dereference', () => {
  it('follows a local ref and unescapes JSON-pointer segments', () => {
    expect(resolveLocalRef(DOC, '#/components/schemas/Status')).toEqual(DOC.components.schemas.Status);
    const doc = { components: { schemas: { 'a/b': { type: 'string' } } } };
    expect(resolveLocalRef(doc, '#/components/schemas/a~1b')).toEqual({ type: 'string' });
  });

  it('returns undefined for external, missing or non-object targets', () => {
    expect(resolveLocalRef(DOC, 'https://x/y.json#/A')).toBeUndefined();
    expect(resolveLocalRef(DOC, '#/components/schemas/Nope')).toBeUndefined();
    expect(resolveLocalRef({ a: 'str' }, '#/a')).toBeUndefined();
    expect(resolveLocalRef(DOC, 42)).toBeUndefined();
  });

  it('never resolves prototype members and decodes percent-encoded segments', () => {
    expect(resolveLocalRef(DOC, '#/constructor')).toBeUndefined();
    expect(resolveLocalRef(DOC, '#/__proto__')).toBeUndefined();
    const doc = { components: { schemas: { 'Order {id}': { type: 'string' } } } };
    expect(resolveLocalRef(doc, '#/components/schemas/Order%20%7Bid%7D')).toEqual({ type: 'string' });
  });

  it('terminates on a pure ref loop', () => {
    expect(dereference(DOC, { $ref: '#/components/schemas/A' })).toBeUndefined();
  });
});

describe('generateExample', () => {
  it('generates primitives, enums, nested objects, arrays, allOf merges and example/default wins', () => {
    expect(generateExample(DOC, { $ref: '#/components/schemas/Order' })).toEqual({
      id: 0,
      status: 'paid',
      address: { city: '', zip: 0 },
      tags: [''],
      paid: false,
      note: 'fragile',
      qty: 3,
    });
  });

  it('takes the first oneOf/anyOf branch', () => {
    expect(generateExample(DOC, { oneOf: [{ type: 'boolean' }, { type: 'string' }] })).toBe(false);
    expect(generateExample(DOC, { anyOf: [{ type: 'integer' }] })).toBe(0);
  });

  it('is cycle-safe: a self-referencing schema terminates with a null cyclic branch', () => {
    expect(generateExample(DOC, { $ref: '#/components/schemas/Node' })).toEqual({ value: '', next: null });
  });

  it('degrades unknown, unresolvable and ref-loop schemas to null without throwing', () => {
    expect(generateExample(DOC, { $ref: '#/components/schemas/Missing' })).toBeNull();
    expect(generateExample(DOC, { $ref: '#/components/schemas/A' })).toBeNull();
    expect(generateExample(DOC, undefined)).toBeNull();
    expect(generateExample(DOC, {})).toBeNull();
  });

  it('truncates very deep inline schemas to null at the depth bound', () => {
    let schema: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 30; i += 1) {
      schema = { type: 'object', properties: { child: schema } };
    }
    let value = generateExample(DOC, schema) as Record<string, unknown> | null;
    let levels = 0;
    while (value !== null && typeof value === 'object') {
      value = value['child'] as Record<string, unknown> | null;
      levels += 1;
    }
    expect(value).toBeNull();
    expect(levels).toBe(9);
  });

  it('bounds the total node count of a wide, fanning-out schema', () => {
    const wide = { type: 'object', properties: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`p${i}`, { $ref: '#/components/schemas/Wide' }])) };
    const doc = { components: { schemas: { Wide: wide } } };
    const started = Date.now();
    expect(() => generateExample(doc, { $ref: '#/components/schemas/Wide' })).not.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('skips an unresolvable first oneOf branch in favor of a valid later one', () => {
    expect(generateExample(DOC, { oneOf: [{ $ref: '#/components/schemas/Missing' }, { type: 'boolean' }] })).toBe(false);
  });

  it('uses the first non-null entry of an OpenAPI 3.1 type array', () => {
    expect(generateExample(DOC, { type: ['null', 'integer'] })).toBe(0);
    expect(generateExample(DOC, { type: ['string', 'null'] })).toBe('');
  });

  it('returns a copy of spec-provided example values (no aliasing of the spec)', () => {
    const doc = { s: { type: 'object', example: { a: [1] } } };
    const first = generateExample(doc, doc.s) as { a: number[] };
    first.a.push(2);
    expect(doc.s.example).toEqual({ a: [1] });
  });

  it('skips allOf parts that are ancestors of themselves without dropping own properties', () => {
    const doc = {
      components: {
        schemas: {
          Self: { allOf: [{ $ref: '#/components/schemas/Self' }], type: 'object', properties: { id: { type: 'integer' } } },
        },
      },
    };
    expect(generateExample(doc, { $ref: '#/components/schemas/Self' })).toEqual({ id: 0 });
  });
});
