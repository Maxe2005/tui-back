// core/scripts/resolve-merge-sources: pure resolution of each update target's merge source
// when merging from another EDT. Shared by the TUI configuration screen and the CLI so both
// resolve identically. A branch counts as present only with a local ref — the update's own
// source check is local-only, so an origin-only branch would be rejected later anyway.
import { resolve } from 'node:path';
import type { EdtMember, EdtRegistryEntry } from '../ports/edt-registry.js';

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
