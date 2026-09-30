// adapters/driven/modules/route-explorer/schema-example: pure unit tests (story 6.6) —
// $ref resolution and skeleton generation, including the bounded/cycle-safe guarantees.
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

  it('bounds depth on very deep inline schemas', () => {
    let schema: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 30; i += 1) {
      schema = { type: 'object', properties: { child: schema } };
    }
    expect(() => generateExample(DOC, schema)).not.toThrow();
  });
});
