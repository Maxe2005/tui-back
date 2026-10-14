// core/shared-types/version-history: the read-only History library over the shared-types source
// repo — "which version is on my branch?" (by-branch: version bumps newest first) and "where was
// 0.1.3770 released?" (by-version: bumping commit, containing branches, date). Pure orchestration
// over GitPort: results are streamed through callbacks and every walk is cancellable through an
// AbortSignal — after an abort no further entry is reported. Nothing is cached, fetched or written.
import { err, ok, type Result } from '../result.js';
import type { GitPort } from '../ports/git.js';

// By-version input is strict: three digit groups, nothing else (no prerelease suffix, no `v`).
const HISTORY_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export function isValidHistoryVersion(version: string): boolean {
  return HISTORY_VERSION_PATTERN.test(version.trim());
}

export type VersionHistoryEntry = { version: string; commit: string; date: string; branch: string };

export type BranchSearchEnd = 'depth' | 'scanned' | 'exhausted' | 'aborted';

export type BranchSearchResult = { endedBy: BranchSearchEnd; entries: VersionHistoryEntry[]; scanned: number };

export async function searchByBranch(input: {
  git: GitPort;
  repoPath: string;
  branch: string;
  depth: number;
  maxScanned: number;
  signal?: AbortSignal;
  onEntry?: (entry: VersionHistoryEntry) => void;
}): Promise<Result<BranchSearchResult>> {
  const { git, repoPath, branch, depth, maxScanned, signal, onEntry } = input;
  const branchName = branch.trim();
  if (branchName === '') {
    return err('invalid-branch', 'Enter a branch to search.');
  }
  const entries: VersionHistoryEntry[] = [];
  const walked = await git.listVersionBumpCommits(repoPath, branchName, {
    limit: depth,
    maxScanned,
    ...(signal === undefined ? {} : { signal }),
    onEntry: (bump) => {
      if (signal?.aborted === true) {
        return;
      }
      const entry = { version: bump.version, commit: bump.commit, date: bump.date, branch: branchName };
      entries.push(entry);
      onEntry?.(entry);
    },
  });
  if (!walked.ok) {
    return walked;
  }
  const endedBy: BranchSearchEnd =
    signal?.aborted === true || walked.data.endedBy === 'aborted'
      ? 'aborted'
      : walked.data.endedBy === 'limit'
        ? 'depth'
        : walked.data.endedBy;
  return ok({ endedBy, entries, scanned: walked.data.scanned });
}

export type VersionHit = {
  commit: string;
  date: string;
  branches: string[];
  // True on the hit whose commit is the oldest one that introduced the version.
  earliest: boolean;
};

export type VersionSearchResult = {
  version: string;
  found: boolean;
  aborted: boolean;
  hits: VersionHit[];
  // Every branch containing a bumping commit, once each.
  branches: string[];
  // The branch whose containing bump commit has the oldest author date (null when not found).
  earliestBranch: string | null;
};

const EVERY_COMMIT = 1_000_000;

export async function searchByVersion(input: {
  git: GitPort;
  repoPath: string;
  version: string;
  signal?: AbortSignal;
  onHit?: (hit: VersionHit) => void;
}): Promise<Result<VersionSearchResult>> {
  const { git, repoPath, signal, onHit } = input;
  const isAborted = (): boolean => signal?.aborted === true;
  const version = input.version.trim();
  if (!isValidHistoryVersion(version)) {
    return err('invalid-version', `"${version}" is not a MAJOR.MINOR.PATCH version (digits only).`);
  }
  const bumps: { commit: string; date: string }[] = [];
  const walked = await git.listVersionBumpCommits(repoPath, '--all', {
    limit: EVERY_COMMIT,
    maxScanned: EVERY_COMMIT,
    pickaxeVersion: version,
    ...(signal === undefined ? {} : { signal }),
    onEntry: (bump) => {
      if (bump.version === version && !isAborted()) {
        bumps.push({ commit: bump.commit, date: bump.date });
      }
    },
  });
  if (!walked.ok) {
    return walked;
  }
  const hits: VersionHit[] = [];
  const branchesInOrder: string[] = [];
  // Branch -> oldest bump commit date it contains.
  const branchOldest = new Map<string, number>();
  for (const bump of bumps) {
    if (isAborted()) {
      break;
    }
    const containing = await git.listBranchesContaining(repoPath, bump.commit, signal);
    if (!containing.ok) {
      return containing;
    }
    if (isAborted()) {
      break;
    }
    const time = Date.parse(bump.date);
    for (const name of containing.data) {
      if (!branchesInOrder.includes(name)) {
        branchesInOrder.push(name);
      }
      const known = branchOldest.get(name);
      if (known === undefined || time < known) {
        branchOldest.set(name, time);
      }
    }
    const hit: VersionHit = { commit: bump.commit, date: bump.date, branches: containing.data, earliest: false };
    hits.push(hit);
    onHit?.(hit);
  }
  const aborted = isAborted() || walked.data.endedBy === 'aborted';
  let earliestHit: VersionHit | undefined;
  for (const hit of hits) {
    if (earliestHit === undefined || Date.parse(hit.date) < Date.parse(earliestHit.date)) {
      earliestHit = hit;
    }
  }
  const resultHits = hits.map((hit) => ({ ...hit, earliest: hit === earliestHit }));
  let earliestBranch: string | null = null;
  let oldest = Infinity;
  for (const name of branchesInOrder) {
    const time = branchOldest.get(name) ?? Infinity;
    if (time < oldest) {
      oldest = time;
      earliestBranch = name;
    }
  }
  return ok({ version, found: resultHits.length > 0, aborted, hits: resultHits, branches: branchesInOrder, earliestBranch });
}
