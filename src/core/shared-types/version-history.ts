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
  if (branchName.startsWith('-')) {
    return err('invalid-branch', `"${branchName}" is not a branch name (it starts with "-").`);
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
  // The walk stopped at a bound before the whole history was scanned: "not found" is then
  // only "not found so far".
  truncated: boolean;
  hits: VersionHit[];
  // Every branch containing a bumping commit, once each.
  branches: string[];
  // The branch whose containing bump commit has the oldest author date (null when not found).
  earliestBranch: string | null;
};

const EVERY_COMMIT = 1_000_000;

function timeOf(date: string): number {
  const time = Date.parse(date);
  return Number.isNaN(time) ? Infinity : time;
}

// Streams: each hit is reported as soon as its bumping commit and containing branches are
// resolved, while the walk keeps going. Branch lookups run one at a time, in walk order.
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
  const hits: VersionHit[] = [];
  let failure: Extract<Result<never>, { ok: false }> | null = null;
  let chain: Promise<void> = Promise.resolve();
  const walked = await git.listVersionBumpCommits(repoPath, '', {
    allRefs: true,
    limit: EVERY_COMMIT,
    maxScanned: EVERY_COMMIT,
    pickaxeVersion: version,
    ...(signal === undefined ? {} : { signal }),
    onEntry: (bump) => {
      if (bump.version !== version) {
        return;
      }
      chain = chain.then(async () => {
        if (failure !== null || isAborted()) {
          return;
        }
        const containing = await git.listBranchesContaining(repoPath, bump.commit, signal);
        if (!containing.ok) {
          if (!isAborted()) {
            failure = containing;
          }
          return;
        }
        if (isAborted()) {
          return;
        }
        const hit: VersionHit = { commit: bump.commit, date: bump.date, branches: containing.data, earliest: false };
        hits.push(hit);
        onHit?.(hit);
      });
    },
  });
  await chain;
  if (!walked.ok) {
    return walked;
  }
  if (failure !== null) {
    return failure;
  }
  const aborted = isAborted() || walked.data.endedBy === 'aborted';
  const truncated = walked.data.endedBy === 'limit' || walked.data.endedBy === 'scanned';
  // A hit with no containing branch (or an unparsable date) can never be "the earliest".
  let earliestHit: VersionHit | undefined;
  for (const hit of hits) {
    if (hit.branches.length > 0 && timeOf(hit.date) !== Infinity && (earliestHit === undefined || timeOf(hit.date) < timeOf(earliestHit.date))) {
      earliestHit = hit;
    }
  }
  const resultHits = hits.map((hit) => ({ ...hit, earliest: hit === earliestHit }));
  const branchesInOrder: string[] = [];
  const branchOldest = new Map<string, number>();
  for (const hit of hits) {
    for (const name of hit.branches) {
      if (!branchesInOrder.includes(name)) {
        branchesInOrder.push(name);
      }
      const known = branchOldest.get(name);
      if (known === undefined || timeOf(hit.date) < known) {
        branchOldest.set(name, timeOf(hit.date));
      }
    }
  }
  let earliestBranch: string | null = null;
  let oldest = Infinity;
  for (const name of branchesInOrder) {
    const time = branchOldest.get(name) ?? Infinity;
    if (time < oldest) {
      oldest = time;
      earliestBranch = name;
    }
  }
  return ok({ version, found: resultHits.length > 0, aborted, truncated, hits: resultHits, branches: branchesInOrder, earliestBranch });
}
