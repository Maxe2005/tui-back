// tui/zones/update: story 3.7 — Ink smoke coverage for the pre-run configuration screen:
// every targeted service pre-selected with its branch, the two toggles, the inline error,
// and the branch editor all render (per the epic context, TUI screens get smoke-tests only;
// the behavior behind every row is unit-tested in update-config-dialog.test.ts).
import { describe, expect, it } from 'vitest';
import { UpdateConfigDialog, UPDATE_CONFIG_HINTS, UPDATE_CONFIG_TITLE_ALL, UPDATE_CONFIG_TITLE_EDT } from './update-config-dialog.js';
import { createUpdateConfigDraft, toggleUpdateConfigRow, type UpdateConfigDraft } from './update-config-dialog.logic.js';
import { renderToString } from '../../shared/components/render-to-string.js';

function edtDraft(): UpdateConfigDraft {
  return createUpdateConfigDraft('edt', [
    { service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development' },
    { service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'release/1' },
  ]);
}

const IDLE_SOURCE = { branches: [] as string[], branchesStatus: 'ready' as const, maxRows: 5 };

describe('UpdateConfigDialog rendering', () => {
  it('lists every targeted service pre-selected with its branch plus both toggles and the hints', async () => {
    const output = await renderToString(<UpdateConfigDialog draft={edtDraft()} view={{ cursor: 0, editing: null }} {...IDLE_SOURCE} />);

    expect(output).toContain(UPDATE_CONFIG_TITLE_EDT);
    expect(output).toContain('svc-a');
    expect(output).toContain('svc-b');
    expect(output).toContain('/repo/a');
    expect(output).toContain('development');
    expect(output).toContain('release/1');
    expect(output).toContain('[x]');
    expect(output).toContain('Run migrations');
    expect(output).toContain('Clean restart');
    expect(output).toContain(UPDATE_CONFIG_HINTS);
  });

  it('renders the all-repos title variant when pre-scoped to every managed repo', async () => {
    const draft = createUpdateConfigDraft('all', [{ service: 'a', repoPath: '/repo/a', sourceBranch: 'development' }]);

    const output = await renderToString(<UpdateConfigDialog draft={draft} view={{ cursor: 0, editing: null }} {...IDLE_SOURCE} />);

    expect(output).toContain(UPDATE_CONFIG_TITLE_ALL);
    expect(output).not.toContain(UPDATE_CONFIG_TITLE_EDT);
  });

  it('marks a deselected service [ ] while the others stay [x]', async () => {
    const draft = toggleUpdateConfigRow(edtDraft(), 1);

    const output = await renderToString(<UpdateConfigDialog draft={draft} view={{ cursor: 0, editing: null }} {...IDLE_SOURCE} />);

    expect(output).toContain('[ ]');
    expect(output).toContain('[x]');
  });

  it('surfaces the inline error (zero-selection reject, blank branch) with the screen still open', async () => {
    const draft: UpdateConfigDraft = { ...edtDraft(), error: 'No services selected — select at least one service before starting the run.' };

    const output = await renderToString(<UpdateConfigDialog draft={draft} view={{ cursor: 0, editing: null }} {...IDLE_SOURCE} />);

    expect(output).toContain('No services selected');
    // The screen is still open: rows and toggles still render alongside the error.
    expect(output).toContain('svc-a');
    expect(output).toContain('Run migrations');
  });

  it('renders duplicate service rows sharing one repoPath as separate rows', async () => {
    const draft = createUpdateConfigDraft('edt', [
      { service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development' },
      { service: 'svc-a-clone', repoPath: '/repo/a', sourceBranch: 'development' },
    ]);

    const output = await renderToString(<UpdateConfigDialog draft={draft} view={{ cursor: 0, editing: null }} {...IDLE_SOURCE} />);

    expect(output).toContain('svc-a-clone');
    expect(output).toContain('svc-a');
  });

  it('renders the focused branch editor with its current value', async () => {
    const output = await renderToString(
      <UpdateConfigDialog draft={edtDraft()} view={{ cursor: 0, editing: { value: 'release/', cursor: 8, pickCursor: 0 } }} {...IDLE_SOURCE} />,
    );

    expect(output).toContain('Merge from');
    expect(output).toContain('release/');
  });

  it('autocompletes the open editor from that row branches with validity, capped at maxRows', async () => {
    const output = await renderToString(
      <UpdateConfigDialog
        draft={edtDraft()}
        view={{ cursor: 0, editing: { value: '', cursor: 0, pickCursor: 0 } }}
        branches={['b-one', 'b-two', 'b-three']}
        branchesStatus="ready"
        maxRows={2}
      />,
    );

    expect(output).toContain('Merge from');
    expect(output).toContain('b-one');
    expect(output).toContain('b-two');
    expect(output).not.toContain('b-three');
    expect(output).toContain('… 1 more');
    expect(output).toContain('✖');
  });

  it('shows ✔ when the open editor exactly matches a listed branch', async () => {
    const output = await renderToString(
      <UpdateConfigDialog
        draft={edtDraft()}
        view={{ cursor: 0, editing: { value: 'development', cursor: 11, pickCursor: 0 } }}
        branches={['development', 'main']}
        branchesStatus="ready"
        maxRows={5}
      />,
    );

    expect(output).toContain('✔');
    expect(output).not.toContain('✖');
  });

  it('keeps the `Failed to load branches.` line with a usable field on branchesStatus=error', async () => {
    const output = await renderToString(
      <UpdateConfigDialog
        draft={edtDraft()}
        view={{ cursor: 0, editing: { value: 'dev', cursor: 3, pickCursor: 0 } }}
        branches={[]}
        branchesStatus="error"
        maxRows={5}
      />,
    );

    expect(output).toContain('Failed to load branches.');
    expect(output).toContain('Merge from');
    expect(output).toContain('dev');
  });
});
