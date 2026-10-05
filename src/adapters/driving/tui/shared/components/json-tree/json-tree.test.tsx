import { describe, expect, it } from 'vitest';
import { colors, jsonTreeColors } from '../../theme/theme.js';
import { renderToString } from '../render-to-string.js';
import { flattenJson, type TreeFilterRules } from './model.js';
import { JsonEmptyState, JsonRawFallback, JsonRawEditor, JsonTree, JsonTreeEditor } from './json-tree.js';

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
      panelCursor={0}
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
      <JsonTree rows={rows} selected={0} hiddenCount={1} activeRuleCount={0} rules={[]} hideNulls={false} panelOpen={false} panelCursor={0} maxVisibleRows={30} />,
    );
    expect(output).toContain('a');
    expect(output).not.toContain('b');
    expect(output).toContain('1 hidden · 0 rules');
  });

  it('renders only the visible rows inside a small budget', async () => {
    const value = { rows: Array.from({ length: 20 }, (_, i) => i) };
    const rows = flattenJson(value, [], NO_RULES);
    const output = await renderToString(
      <JsonTree rows={rows} selected={0} hiddenCount={0} activeRuleCount={0} rules={[]} hideNulls={false} panelOpen={false} panelCursor={0} maxVisibleRows={6} />,
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
        panelCursor={1}
        maxVisibleRows={30}
      />,
    );
    expect(output).toContain('[1] hide "tags"');
    expect(output).toContain('[2] only "id"');
    expect(output).toContain('[n] hide nulls: on');
    expect(output).toContain('2 hidden · 2 rules');
    expect(output).toContain('› [2] only "id"');
    expect(output).toContain('[space] remove');
  });

  it('shows no panel when closed', async () => {
    const output = await renderToString(treeFor({ a: 1 }));
    expect(output).not.toContain('[n] hide nulls');
  });

  it('names the all-filtered state instead of rendering blank', async () => {
    const output = await renderToString(
      <JsonTree rows={[]} selected={0} hiddenCount={4} activeRuleCount={1} rules={[{ kind: 'hide', key: 'a' }]} hideNulls={false} panelOpen={false} panelCursor={0} maxVisibleRows={30} />,
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

  it('marks the selected raw line visibly', async () => {
    const output = await renderToString(<JsonRawFallback reason="not JSON" lines={['a', 'b', 'c']} selected={2} maxVisibleRows={10} />);
    expect(output).toContain('› c');
  });
});

describe('JsonEmptyState', () => {
  it('distinguishes an empty body from an empty JSON value', async () => {
    expect(await renderToString(<JsonEmptyState emptyKind="empty-body" />)).toContain('Empty response body');
    expect(await renderToString(<JsonEmptyState emptyKind="empty-json" />)).toContain('Empty JSON value');
  });
});

describe('JsonTreeEditor', () => {
  function editorFor(value: unknown, extra: Record<string, unknown> = {}) {
    const rows = value === undefined ? [] : flattenJson(value, [], NO_RULES);
    return (
      <JsonTreeEditor
        rows={rows}
        selected={0}
        hiddenCount={0}
        rules={[]}
        hideNulls={false}
        panelOpen={false}
        panelCursor={0}
        maxVisibleRows={30}
        bodyEmpty={value === undefined}
        editErrors={{}}
        firstError={null}
        editingPath={null}
        editInput={null}
        editLabel="Edit"
        addPrompt={null}
        {...extra}
      />
    );
  }

  it('renders the draft tree with the still-sent status line', async () => {
    const output = await renderToString(editorFor({ name: 'ada' }));
    expect(output).toContain('name');
    expect(output).toContain('"ada"');
    expect(output).toContain('0 lines hidden — still sent');
  });

  it('renders invalid entries in error color with their reason and surfaces the first error', async () => {
    const output = await renderToString(
      editorFor(
        { age: '12x' },
        {
          editErrors: { age: { reason: 'expected a number, got "12x"', kind: 'number' } },
          firstError: 'expected a number, got "12x"',
        },
      ),
    );
    expect(output).toContain('12x');
    expect(output).toContain('✖');
    expect(output).toContain('expected a number');
  });

  it('shows N lines hidden — still sent whenever filters hide rows', async () => {
    const rows = flattenJson({ a: 1, b: 2 }, [], NO_RULES);
    const output = await renderToString(editorFor({ a: 1, b: 2 }, { rows, hiddenCount: 3 }));
    expect(output).toContain('3 lines hidden — still sent');
  });

  it('renders the inline scalar editor row while editing', async () => {
    const output = await renderToString(editorFor({ age: 36 }, { editingPath: 'age', editInput: { value: '37', cursor: 2 }, editLabel: 'Edit age' }));
    expect(output).toContain('Edit age');
    expect(output).toContain('37');
  });

  it('renders the add-key prompt with its duplicate rejection inline', async () => {
    const output = await renderToString(
      editorFor({ id: 1 }, { addPrompt: { parentPath: '', input: { value: 'id', cursor: 2 }, error: 'duplicate key: "id"' } }),
    );
    expect(output).toContain('Key name');
    expect(output).toContain('duplicate key');
  });

  it('names the empty-body state with the r hint instead of the all-filtered line', async () => {
    const output = await renderToString(editorFor(undefined));
    expect(output).toContain('Empty body');
    expect(output).toContain('press r');
    expect(output).not.toContain('All lines hidden');
  });

  it('names a genuinely-empty value instead of the all-filtered line when no rules hide rows', async () => {
    const empty = await renderToString(
      <JsonTreeEditor
        rows={[]}
        selected={0}
        hiddenCount={0}
        rules={[]}
        hideNulls={false}
        panelOpen={false}
        panelCursor={0}
        maxVisibleRows={30}
        bodyEmpty={false}
        editErrors={{}}
        firstError={null}
        editingPath={null}
        editInput={null}
        editLabel="Edit"
        addPrompt={null}
      />,
    );
    expect(empty).toContain('Empty JSON value');
    expect(empty).not.toContain('All lines hidden');
    const filtered = await renderToString(
      <JsonTreeEditor
        rows={[]}
        selected={0}
        hiddenCount={4}
        rules={[{ kind: 'hide', key: 'a' }]}
        hideNulls={false}
        panelOpen={false}
        panelCursor={0}
        maxVisibleRows={30}
        bodyEmpty={false}
        editErrors={{}}
        firstError={null}
        editingPath={null}
        editInput={null}
        editLabel="Edit"
        addPrompt={null}
      />,
    );
    expect(filtered).toContain('All lines hidden by filters');
  });

  it('renders only the visible rows inside a small budget', async () => {
    const value = { rows: Array.from({ length: 20 }, (_, i) => i) };
    const output = await renderToString(editorFor(value, { maxVisibleRows: 6 }));
    expect(output).toContain('more below');
    expect(output).not.toContain('[19]');
  });
});

describe('JsonRawEditor', () => {
  it('renders the buffer with its newline/done hints', async () => {
    const output = await renderToString(<JsonRawEditor input={{ value: '{"a":1}', cursor: 7 }} error={null} maxVisibleRows={10} />);
    expect(output).toContain('{"a":1}');
    expect(output).toContain('[enter] newline');
    expect(output).toContain('[esc] done');
  });

  it('keeps parse errors visible with the buffer preserved', async () => {
    const output = await renderToString(
      <JsonRawEditor input={{ value: '{"a":}', cursor: 6 }} error={'Unexpected token (line 1, column 7)'} maxVisibleRows={10} />,
    );
    expect(output).toContain('{"a":}');
    expect(output).toContain('✖');
    expect(output).toContain('line 1');
  });

  it('windows long buffers instead of growing', async () => {
    const value = Array.from({ length: 20 }, (_, i) => `line-${i}`).join('\n');
    const output = await renderToString(<JsonRawEditor input={{ value, cursor: 0 }} error={null} maxVisibleRows={5} />);
    expect(output).toContain('more below');
    expect(output).not.toContain('line-19');
  });
});
