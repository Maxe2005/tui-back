import { describe, it, expect } from 'vitest';
import { FailedResultList, resolveAssistedAction } from './index.js';
import { renderToString } from './render-to-string.js';

describe('resolveAssistedAction', () => {
  it('resolves branch-owned-by-other-edt to the "try a different branch" action', () => {
    expect(resolveAssistedAction('branch-owned-by-other-edt')).toEqual({ label: 'try a different branch' });
  });

  // The second registry entry — branch-exists (the git adapter's createBranch/renameBranch) ->
  // "try a different name", backing the branch-picker's Create-new and rename retry flows.
  it('resolves branch-exists to the "try a different name" action', () => {
    expect(resolveAssistedAction('branch-exists')).toEqual({ label: 'try a different name' });
  });

  it('returns null for an unregistered code', () => {
    expect(resolveAssistedAction('shared-branch-rejected')).toBeNull();
    expect(resolveAssistedAction('no .tui-back.yaml found')).toBeNull();
  });

  it('returns null when no code is present at all', () => {
    expect(resolveAssistedAction(undefined)).toBeNull();
  });
});

describe('FailedResultList', () => {
  it('renders nothing for an empty row list', async () => {
    const output = await renderToString(<FailedResultList rows={[]} />);
    expect(output.trim()).toBe('');
  });

  it('renders one line per failed repo, never a joined string', async () => {
    const output = await renderToString(
      <FailedResultList
        rows={[
          { service: 'svc-a', message: 'Branch "development" is shared/protected' },
          { service: 'svc-b', message: 'Working tree has uncommitted changes' },
        ]}
      />,
    );
    expect(output).toContain('svc-a: Branch "development" is shared/protected');
    expect(output).toContain('svc-b: Working tree has uncommitted changes');
    // Never the old `; `-joined single string.
    expect(output).not.toContain('svc-a: Branch "development" is shared/protected; svc-b');
  });

  it('grows an inline [Enter] affordance only for a row whose code resolves to a registered action', async () => {
    const output = await renderToString(
      <FailedResultList
        rows={[
          {
            service: 'svc-a',
            code: 'branch-owned-by-other-edt',
            message: 'Branch "feature-x" is already registered as a different EDT\'s own branch',
          },
          { service: 'svc-b', code: 'shared-branch-rejected', message: 'Branch "development" is shared/protected' },
          { service: 'svc-c', message: 'no .tui-back.yaml found' },
        ]}
      />,
    );
    expect(output).toContain('[Enter] try a different branch');
    // Exactly one affordance — the other two rows' codes don't resolve to any action.
    expect(output.split('[Enter] try a different branch')).toHaveLength(2);
  });

  it('grows the "try a different name" affordance for a branch-exists row', async () => {
    const output = await renderToString(
      <FailedResultList rows={[{ service: 'svc-a', code: 'branch-exists', message: 'Branch "feature-x" already exists' }]} />,
    );
    expect(output).toContain('[Enter] try a different name');
  });
});
