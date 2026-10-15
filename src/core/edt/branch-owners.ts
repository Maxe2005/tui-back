// core/edt/branch-owners: pure lookup of which EDTs register a given branch of
// a given repo as one of their own member branches. Single source for the git adapter's
// rename gate and the TUI's chooser annotations / inline refusals. Paths are compared after
// resolve() so a registry-stored shape (trailing slash, relative segments) still matches.
import { resolve } from 'node:path';
import type { EdtRegistryEntry } from '../ports/edt-registry.js';

export function branchOwners(
  edts: readonly Pick<EdtRegistryEntry, 'ulid' | 'topic' | 'members'>[],
  repoPath: string,
  branch: string,
  excludeUlid?: string,
): string[] {
  const target = resolve(repoPath);
  return edts
    .filter(
      (edt) =>
        edt.ulid !== excludeUlid &&
        edt.members.some((member) => member.branch === branch && resolve(member.repoPath) === target),
    )
    .map((edt) => edt.topic);
}

// owners of every candidate that has at least one — branch -> topics (registry
// order). Branches nobody owns are absent, so a lookup doubles as the "owned?" test. Feeds the
// choosers' annotations without the pickers/inputs ever importing the EDT list.
export function branchOwnersMap(
  edts: readonly Pick<EdtRegistryEntry, 'ulid' | 'topic' | 'members'>[],
  repoPath: string,
  branches: readonly string[],
  excludeUlid?: string,
): Record<string, string[]> {
  // Null prototype: a branch named `constructor`/`__proto__` is plain data, never inherited.
  const owned = Object.create(null) as Record<string, string[]>;
  for (const branch of branches) {
    const topics = branchOwners(edts, repoPath, branch, excludeUlid);
    if (topics.length > 0) {
      owned[branch] = topics;
    }
  }
  return owned;
}
