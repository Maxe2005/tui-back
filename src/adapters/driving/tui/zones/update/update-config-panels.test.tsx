// tui/zones/update: Ink rendering of the two-panel configuration — layout, effective cells,
// scope differences, the service box and the height budget.
import { describe, expect, it } from 'vitest';
import { UpdateConfigPanels, PANELS_TOO_SMALL } from './update-config-panels.js';
import { FOOTER_CONTEXTS } from '../../keybindings/index.js';
import { applyMergeStrategy, createUpdateConfigDraft, type UpdateConfigDraft } from './update-config-dialog.logic.js';
import { CONFIG_CHROME_ROWS, CONFIG_MIN_ROWS, SERVICE_BOX_ROWS, computeConfigBudget, setRow, toggleMergeSource, type PanelsViewState } from './update-config-panels.logic.js';
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

describe('UpdateConfigPanels shared-types row', () => {
  it('renders the three-way row only when a single source is among the rows', async () => {
    const plain = draftWith(2);
    expect(await render(plain, 30)).not.toContain('shared-types');
    const withSource = { ...plain, sharedTypesSource: '/r/0' };
    expect(await render(withSource, 30)).toContain('< off >');
    expect(await render({ ...withSource, sharedTypes: 'if-changed' }, 30)).toContain('publish if the merge changed something');
    expect(await render({ ...withSource, sharedTypes: 'always' }, 30)).toContain('always publish');
  });
});

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
    expect(output).toContain('custom');
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

  it('fits exactly the minimum height for several services, in both multi-service layouts', async () => {
    for (const layout of ['edt-panels', 'all-panels'] as const) {
      for (const count of [2, 3, 40]) {
        const output = await render(draftWith(count, layout), CONFIG_MIN_ROWS);
        expect(output).not.toContain('Terminal too small');
        expect(lineCount(output)).toBeLessThanOrEqual(CONFIG_MIN_ROWS);
      }
    }
    expect(await render(draftWith(3), CONFIG_MIN_ROWS - 1)).toContain('Terminal too small');
  });

  it('keeps the service box and its suggestion list inside the height it budgets', async () => {
    const rows = CONFIG_CHROME_ROWS + SERVICE_BOX_ROWS + 5;
    const draft = draftWith(3);
    const budget = computeConfigBudget(rows, draft, false, 5, true);
    expect(budget.boxDropdownLines).toBe(5);
    const box = { ...openServiceBox(draft, 0)!, editing: true };
    const many = Array.from({ length: 30 }, (_, index) => `branch-${index}`);
    const output = await render(draft, rows, VIEW, {
      box,
      boxContext: { service: 'svc-0', branches: many, branchesStatus: 'ready', migrationDeclared: true, recipeDeclared: true },
    });
    expect(lineCount(output)).toBeLessThanOrEqual(rows - 2);
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

  it('a one-service screen fits an 18-row terminal where the table has one row, and asks for more below that', async () => {
    const draft = createUpdateConfigDraft('edt', [{ service: 'svc-1', repoPath: '/repo/1', sourceBranch: 'development' }], { layout: 'service-panels' });
    const fits = await render(draft, 18);
    expect(fits).toContain('svc-1');
    expect(fits).toContain('[ Start run ]');
    expect(fits).not.toContain('Terminal too small');
    expect(lineCount(fits)).toBeLessThanOrEqual(18);
    expect(await render(draft, 17)).toContain('Terminal too small');
  });

  it('the global-panel footer context says how to start the run', () => {
    expect(JSON.stringify(FOOTER_CONTEXTS['update-config-global'].hints)).toContain('Start run');
  });

  describe('branch autocomplete through the service box', () => {
    const branches = ['development', 'dev-a', 'dev-b', 'dev-c', 'dev-d', 'dev-e', 'dev-f', 'zzz'];
    async function renderBox(value: string, windowRows = 40) {
      const draft = draftWith(2);
      const box = { ...openServiceBox(draft, 0)!, editing: true, line: 'branch' as const, branch: createSuggestFieldState(value) };
      return render(draft, windowRows, VIEW, {
        box,
        boxContext: { service: 'svc-1', branches, branchesStatus: 'ready', migrationDeclared: true, recipeDeclared: true },
      });
    }

    it('marks an exact branch as valid and an unknown one as invalid', async () => {
      expect(await renderBox('development')).toContain('✔');
      expect(await renderBox('nope')).toContain('✖');
    });

    it('caps the list at the available lines with overflow indicators and hides the rest', async () => {
      const output = await renderBox('dev', 28);
      expect(output).toContain('↓');
      expect(output).toContain('more');
      expect(output).not.toContain('zzz');
    });
  });
});
