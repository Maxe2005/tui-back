import { describe, expect, it } from 'vitest';
import { colors, jsonTreeColors } from '../../theme/theme.js';
import { renderToString } from '../render-to-string.js';
import { flattenJson, type TreeFilterRules } from './model.js';
import { JsonEmptyState, JsonRawFallback, JsonTree } from './json-tree.js';

const NO_RULES: TreeFilterRules = { hiddenKeys: [], onlyKeys: [], hideNulls: false };

function treeFor(value: unknown, rules: TreeFilterRules = NO_RULES, extra: Record<string, unknown> = {}) {
  const rows = flattenJson(value, [], rules);
  return (
    <JsonTree
      rows={rows}
      selected={0}
      hiddenCount={0}
      activeRuleCount={0}
      rules={[]}
      hideNulls={false}
      panelOpen={false}
      maxVisibleRows={30}
      {...extra}
    />
  );
}

describe('jsonTreeColors (scalar type colors)', () => {
  it('maps string/number/boolean/null/keys onto the existing palette', () => {
    expect(jsonTreeColors).toEqual({
      key: colors.text,
      string: colors.success,
      number: colors.info,
      boolean: colors.warning,
      null: colors['text-dim'],
    });
  });

  it('is frozen at runtime', () => {
    expect(Object.isFrozen(jsonTreeColors)).toBe(true);
  });
});

describe('JsonTree', () => {
  it('renders nested rows with {n}/[n] size hints and key: value lines', async () => {
    const output = await renderToString(treeFor({ name: 'ada', tags: ['x', 'y'] }));
    expect(output).toContain('name');
    expect(output).toContain('"ada"');
    expect(output).toContain('{2}');
    expect(output).toContain('[2]');
    expect(output).toContain('0 hidden · 0 rules');
  });

  it('truncates long strings with … (exact length is the model’s job)', async () => {
    const output = await renderToString(treeFor({ bio: 'b'.repeat(200) }));
    expect(output).toContain('…');
    expect(output).not.toContain('b'.repeat(200));
  });

  it('hides folded children while keeping the folded row', async () => {
    const value = { a: { b: 1 }, d: 2 };
    const rows = flattenJson(value, ['a'], NO_RULES);
    const output = await renderToString(
      <JsonTree rows={rows} selected={0} hiddenCount={1} activeRuleCount={0} rules={[]} hideNulls={false} panelOpen={false} maxVisibleRows={30} />,
    );
    expect(output).toContain('a');
    expect(output).not.toContain('b');
    expect(output).toContain('1 hidden · 0 rules');
  });

  it('renders only the visible rows inside a small budget', async () => {
    const value = { rows: Array.from({ length: 20 }, (_, i) => i) };
    const rows = flattenJson(value, [], NO_RULES);
    const output = await renderToString(
      <JsonTree rows={rows} selected={0} hiddenCount={0} activeRuleCount={0} rules={[]} hideNulls={false} panelOpen={false} maxVisibleRows={6} />,
    );
    expect(output).toContain('more below');
    expect(output).not.toContain('[19]');
  });

  it('lists active rules plus the nulls toggle while the filter panel is open', async () => {
    const output = await renderToString(
      <JsonTree
        rows={flattenJson({ a: 1 }, [], NO_RULES)}
        selected={0}
        hiddenCount={2}
        activeRuleCount={2}
        rules={[
          { kind: 'hide', key: 'tags' },
          { kind: 'only', key: 'id' },
        ]}
        hideNulls
        panelOpen
        maxVisibleRows={30}
      />,
    );
    expect(output).toContain('[1] hide "tags"');
    expect(output).toContain('[2] only "id"');
    expect(output).toContain('[n] hide nulls: on');
    expect(output).toContain('2 hidden · 2 rules');
  });

  it('shows no panel when closed', async () => {
    const output = await renderToString(treeFor({ a: 1 }));
    expect(output).not.toContain('[n] hide nulls');
  });

  it('names the all-filtered state instead of rendering blank', async () => {
    const output = await renderToString(
      <JsonTree rows={[]} selected={0} hiddenCount={4} activeRuleCount={1} rules={[{ kind: 'hide', key: 'a' }]} hideNulls={false} panelOpen={false} maxVisibleRows={30} />,
    );
    expect(output).toContain('All lines hidden by filters');
  });
});

describe('JsonRawFallback', () => {
  it('shows the not-JSON reason with scrollable raw lines', async () => {
    const output = await renderToString(
      <JsonRawFallback reason="not JSON" lines={['<html>', 'hi']} selected={0} maxVisibleRows={10} />,
    );
    expect(output).toContain('not JSON');
    expect(output).toContain('<html>');
  });

  it('shows the truncation reason at the cap', async () => {
    const output = await renderToString(<JsonRawFallback reason="truncated at 64 KB" lines={['half a tree']} selected={0} maxVisibleRows={10} />);
    expect(output).toContain('truncated at 64 KB');
  });

  it('renders only the visible raw lines inside a small budget', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
    const output = await renderToString(<JsonRawFallback reason="not JSON" lines={lines} selected={0} maxVisibleRows={5} />);
    expect(output).toContain('more below');
    expect(output).not.toContain('line-19');
  });
});

describe('JsonEmptyState', () => {
  it('distinguishes an empty body from an empty JSON value', async () => {
    expect(await renderToString(<JsonEmptyState emptyKind="empty-body" />)).toContain('Empty response body');
    expect(await renderToString(<JsonEmptyState emptyKind="empty-json" />)).toContain('Empty JSON value');
  });
});
