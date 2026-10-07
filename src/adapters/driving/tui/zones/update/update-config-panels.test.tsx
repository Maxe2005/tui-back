// tui/zones/update: Ink rendering of the two-panel configuration — layout, effective cells,
// scope differences, the service box and the height budget.
import { describe, expect, it } from 'vitest';
import { UpdateConfigPanels, PANELS_TOO_SMALL } from './update-config-panels.js';
import { applyMergeStrategy, createUpdateConfigDraft, type UpdateConfigDraft } from './update-config-dialog.logic.js';
import { computeConfigBudget, setRow, toggleMergeSource, type PanelsViewState } from './update-config-panels.logic.js';
import { createSuggestFieldState } from '../../shared/components/suggest-field.logic.js';
import { openServiceBox } from './update-service-box.logic.js';
import { renderToString } from '../../shared/components/render-to-string.js';

const VIEW: PanelsViewState = { focus: 'panel', panelCursor: 0, tableCursor: 0, edtField: null };

function draftWith(count: number, layout: 'edt-panels' | 'all-panels' = 'edt-panels'): UpdateConfigDraft {
  const rows = Array.from({ length: count }, (_, index) => ({
    service: `svc-${index}`,
    repoPath: `/r/${index}`,
    sourceBranch: 'development',
    ...(index === 1 ? { migrationDeclared: false } : {}),
  }));
  return createUpdateConfigDraft(layout === 'all-panels' ? 'all' : 'edt', rows, { layout });
}

async function render(draft: UpdateConfigDraft, windowRows: number, view: PanelsViewState = VIEW, extra: Partial<Parameters<typeof UpdateConfigPanels>[0]> = {}) {
  return renderToString(
    <UpdateConfigPanels
      draft={draft}
      view={view}
      budget={computeConfigBudget(windowRows, draft, view.edtField !== null, 5)}
      edtState={createSuggestFieldState('')}
      edtTopics={['sibling', 'hotfix']}
      edtStatus="ready"
      box={null}
      boxContext={null}
      {...extra}
    />,
  );
}

const lineCount = (output: string) => output.split('\n').length;

describe('UpdateConfigPanels', () => {
  it('renders the global panel above the service table with the effective cells', async () => {
    const output = await render(draftWith(3), 30);
    expect(output).toContain('GLOBAL SETTINGS');
    expect(output).toContain('Merge source');
    expect(output).toContain('(•) Shared branches');
    expect(output).toContain('SUMMARY AND PER-SERVICE EXCEPTIONS');
    expect(output).toContain('[x] svc-0');
    expect(output).toContain('✔ migrate');
    expect(output).toContain('— no command');
    expect(output).toContain('basic');
  });

  it('shows the EDT line under From EDT, with errors and the topic marker on rows', async () => {
    const pending = toggleMergeSource(draftWith(2));
    expect(await render(pending, 30)).toContain('✖ no EDT chosen');
    expect(await render(pending, 30)).toContain('<none>');
    const resolved = applyMergeStrategy(draftWith(2), {
      kind: 'edt',
      ulid: 'U',
      topic: 'sibling',
      resolved: [
        { service: 'svc-0', repoPath: '/r/0', source: 'feat/x', origin: 'edt' },
        { service: 'svc-1', repoPath: '/r/1', source: '', origin: 'edt', error: 'not-in-edt' },
      ],
    });
    const output = await render(resolved, 30);
    expect(output).toContain('feat/x ← sibling');
    expect(output).toContain('✖ not in sibling');
  });

  it('all-repos has no merge-source lines', async () => {
    const output = await render(draftWith(2, 'all-panels'), 30);
    expect(output).not.toContain('Merge source');
    expect(output).toContain('Migrations');
    expect(output).toContain('Clean restart');
  });

  it('marks personal rows', async () => {
    const draft = draftWith(2);
    const output = await render(setRow(draft, 0, { ...draft.rows[0]!, migrations: 'off' }), 30);
    expect(output).toContain('perso');
  });

  it('never exceeds the terminal height, even with many rows or an open EDT list', async () => {
    for (const rows of [22, 24, 30]) {
      const many = draftWith(40);
      expect(lineCount(await render(many, rows))).toBeLessThanOrEqual(rows);
      const open = toggleMergeSource(many);
      const view = { ...VIEW, panelCursor: 1, edtField: createSuggestFieldState('') };
      const longList = Array.from({ length: 30 }, (_, index) => `edt-${index}`);
      expect(lineCount(await render(open, rows, view, { edtTopics: longList, edtState: view.edtField }))).toBeLessThanOrEqual(rows);
    }
  });

  it('asks for a bigger terminal below the minimum height instead of overflowing', async () => {
    const output = await render(draftWith(5), 15);
    expect(output).toContain(PANELS_TOO_SMALL.slice(0, 20));
    expect(lineCount(output)).toBeLessThanOrEqual(15);
  });

  it('renders the service box in place of the panels, within the height', async () => {
    const draft = draftWith(3);
    const box = openServiceBox(draft, 1)!;
    const output = await render(draft, 24, VIEW, {
      box,
      boxContext: { service: 'svc-1', branches: ['development', 'feat/x'], branchesStatus: 'ready', migrationDeclared: false, recipeDeclared: true },
    });
    expect(output).toContain('Configure svc-1');
    expect(output).toContain('<shared-branch>');
    expect(output).toContain('— no command declared');
    expect(output).not.toContain('GLOBAL SETTINGS');
    expect(lineCount(output)).toBeLessThanOrEqual(24);
  });
});
