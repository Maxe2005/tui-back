// adapters/driven/modules/route-explorer/schema-example: pure helpers of the `nestjs-openapi`
// scanner — resolve local `#/components/...` `$ref`s (never file/http) and generate a JSON
// example from an OpenAPI schema. Never throws: an unresolvable, unknown or cyclic branch
// degrades to `null`. Output is bounded by depth and by a total node budget.
const MAX_DEPTH = 8;
const MAX_NODES = 2000;
const LOCAL_REF_PREFIX = '#/';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Follows `#/a/b/c` inside `document`; returns undefined for external refs, missing
// targets or non-object targets.
export function resolveLocalRef(document: unknown, ref: unknown): Record<string, unknown> | undefined {
  if (typeof ref !== 'string' || !ref.startsWith(LOCAL_REF_PREFIX)) {
    return undefined;
  }
  let current: unknown = document;
  for (const rawSegment of ref.slice(LOCAL_REF_PREFIX.length).split('/')) {
    let decoded = rawSegment;
    try {
      decoded = decodeURIComponent(rawSegment);
    } catch {
      // A malformed percent-escape is kept literally.
    }
    const segment = decoded.replace(/~1/g, '/').replace(/~0/g, '~');
    // Own keys only: `#/constructor` or `#/__proto__` must never resolve via the prototype.
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return isRecord(current) ? current : undefined;
}

// Dereferences a possibly-`$ref` node (chains bounded so a ref loop cannot spin).
export function dereference(document: unknown, node: unknown): Record<string, unknown> | undefined {
  let current: unknown = node;
  for (let hops = 0; hops <= MAX_DEPTH; hops += 1) {
    if (!isRecord(current)) {
      return undefined;
    }
    if (current['$ref'] === undefined) {
      return current;
    }
    current = resolveLocalRef(document, current['$ref']);
  }
  return undefined;
}

function mergedProperties(
  document: unknown,
  schema: Record<string, unknown>,
  seen: readonly unknown[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const allOf = schema['allOf'];
  if (Array.isArray(allOf)) {
    for (const part of allOf) {
      const resolved = dereference(document, part);
      if (resolved !== undefined && !seen.includes(resolved)) {
        Object.assign(properties, mergedProperties(document, resolved, [...seen, resolved]));
      }
    }
  }
  const own = schema['properties'];
  if (isRecord(own)) {
    Object.assign(properties, own);
  }
  return properties;
}

interface Budget {
  nodes: number;
}

function generate(
  document: unknown,
  node: unknown,
  seen: readonly unknown[],
  depth: number,
  budget: Budget,
): unknown {
  const schema = dereference(document, node);
  budget.nodes -= 1;
  if (schema === undefined || depth > MAX_DEPTH || budget.nodes < 0 || seen.includes(schema)) {
    return null;
  }
  const path = [...seen, schema];
  // Spec-provided values are cloned so a consumer mutating the route never aliases the
  // parsed spec document.
  if (schema['example'] !== undefined) {
    return structuredClone(schema['example']);
  }
  if (schema['default'] !== undefined) {
    return structuredClone(schema['default']);
  }
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return enumValues[0];
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const branches = schema[key];
    if (Array.isArray(branches) && branches.length > 0) {
      // The first branch that yields a real value (an unresolvable or cyclic first branch
      // must not hide a valid alternative).
      for (const branch of branches) {
        const value = generate(document, branch, path, depth + 1, budget);
        if (value !== null) {
          return value;
        }
      }
      return null;
    }
  }

  const properties = mergedProperties(document, schema, path);
  // OpenAPI 3.1 allows `type: ['string', 'null']`: the first non-null entry drives the shape.
  const rawType = schema['type'];
  const declared = Array.isArray(rawType) ? rawType.find((entry) => entry !== 'null') : rawType;
  const type =
    typeof declared === 'string'
      ? declared
      : Object.keys(properties).length > 0 || Array.isArray(schema['allOf'])
        ? 'object'
        : schema['items'] !== undefined
          ? 'array'
          : undefined;

  switch (type) {
    case 'object': {
      const result: Record<string, unknown> = {};
      for (const [name, property] of Object.entries(properties)) {
        result[name] = generate(document, property, path, depth + 1, budget);
      }
      return result;
    }
    case 'array':
      return [generate(document, schema['items'], path, depth + 1, budget)];
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

export function generateExample(document: unknown, schema: unknown): unknown {
  try {
    return generate(document, schema, [], 0, { nodes: MAX_NODES });
  } catch {
    return null;
  }
}
