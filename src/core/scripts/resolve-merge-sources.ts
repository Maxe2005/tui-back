// core/scripts/resolve-merge-sources: pure resolution of each update target's merge source
// when merging from another EDT. Shared by the TUI configuration screen and the CLI so both
// resolve identically. A branch counts as present only with a local ref — the update's own
// source check is local-only, so an origin-only branch would be rejected later anyway.
import { resolve } from 'node:path';
import { err, ok, type Result } from '../result.js';
import type { GitPort } from '../ports/git.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import type { StatePort } from '../ports/state.js';
import type { GroupUpdateSelectionItem } from './group-update.js';

export type MergeSourceOrigin = 'shared' | 'edt' | 'manual';
export type MergeSourceError = 'not-in-edt' | 'branch-not-found';

export interface MergeSourceRow {
  service: string;
  repoPath: string;
  source: string;
  origin: MergeSourceOrigin;
  error?: MergeSourceError;
}

export function resolveMergeSourcesFromEdt(
  targetMembers: readonly Pick<EdtMember, 'service' | 'repoPath'>[],
  sourceEdt: Pick<EdtRegistryEntry, 'members'>,
  localBranchesByRepo: Readonly<Record<string, readonly string[]>>,
): MergeSourceRow[] {
  const sourceByPath = new Map(sourceEdt.members.map((member) => [resolve(member.repoPath), member.branch]));
  return targetMembers.map((target) => {
    const base = { service: target.service, repoPath: target.repoPath };
    const branch = sourceByPath.get(resolve(target.repoPath));
    if (branch === undefined) {
      return { ...base, source: '', origin: 'edt', error: 'not-in-edt' };
    }
    const known = localBranchesByRepo[target.repoPath] ?? [];
    if (!known.includes(branch)) {
      return { ...base, source: '', origin: 'edt', error: 'branch-not-found' };
    }
    return { ...base, source: branch, origin: 'edt' };
  });
}

// Gathers each target's local branch list, then resolves. A repo whose listing fails is
// reported as `branch-not-found` rather than aborting the other rows.
export async function loadMergeSourcesFromEdt(
  git: Pick<GitPort, 'listBranches'>,
  targetMembers: readonly Pick<EdtMember, 'service' | 'repoPath'>[],
  sourceEdt: Pick<EdtRegistryEntry, 'members'>,
): Promise<Result<MergeSourceRow[]>> {
  const branchesByRepo: Record<string, string[]> = {};
  for (const target of targetMembers) {
    const listed = await git.listBranches(target.repoPath);
    branchesByRepo[target.repoPath] = listed.ok ? listed.data : [];
  }
  return ok(resolveMergeSourcesFromEdt(targetMembers, sourceEdt, branchesByRepo));
}

// The non-interactive counterpart of the configuration screen: resolves every member of the
// active EDT from the EDT named `topic` into a full update selection. Fails with no git
// write when the topic is unknown or is the active EDT itself, or when any member cannot
// resolve (the TUI would hold the run on those rows; here there is nobody to fix them).
export async function selectionFromEdt(
  deps: { edtRegistry: EdtRegistryPort; state: StatePort; git: Pick<GitPort, 'listBranches'> },
  topic: string,
): Promise<Result<GroupUpdateSelectionItem[]>> {
  const activeUlid = await deps.state.readActiveEdt();
  if (!activeUlid.ok) {
    return activeUlid;
  }
  const listed = await deps.edtRegistry.list();
  if (!listed.ok) {
    return listed;
  }
  const active = listed.data.find((entry) => entry.ulid === activeUlid.data);
  if (active === undefined) {
    return err('no-active-edt', 'No active EDT — switch to an EDT before running tui-back update');
  }
  const source = listed.data.find((entry) => entry.topic === topic);
  if (source === undefined) {
    return err('invalid-argument', `Unknown EDT topic "${topic}" for --from-edt`);
  }
  if (source.ulid === active.ulid) {
    return err('invalid-argument', `--from-edt cannot name the EDT being updated ("${topic}")`);
  }
  const seen = new Set<string>();
  const targets = active.members.filter((member) => {
    const key = resolve(member.repoPath);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const resolved = await loadMergeSourcesFromEdt(deps.git, targets, source);
  if (!resolved.ok) {
    return resolved;
  }
  const unresolved = resolved.data.filter((row) => row.error !== undefined);
  if (unresolved.length > 0) {
    const names = unresolved.map((row) => row.service);
    return err('update-source-unresolved', `No merge source from EDT "${topic}" for: ${names.join(', ')}`, {
      services: unresolved.map((row) => ({ service: row.service, reason: row.error })),
    });
  }
  return ok(resolved.data.map((row) => ({ service: row.service, repoPath: row.repoPath, sourceBranch: row.source })));
}
