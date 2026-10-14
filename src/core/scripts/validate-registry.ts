// core/scripts/validate-registry: semantic validation of registered repos.
// A schema-valid manifest's declared values must actually be real (e.g. a typo'd
// sharedBranch surfaces here, not later as a confusing create/switch/update failure).
// Read-only throughout: exists() -> load() -> branchExistsLocally() ->
// listRemoteBranches() (remote only on local miss), never fetch/pull/write, no LockPort.
import { ok, type Result } from '../result.js';
import type { GitPort } from '../ports/git.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';

export type ValidateRegistryOutcome = 'valid' | 'invalid' | 'unreachable' | 'inconclusive';

export interface ValidateRegistryEntryResult {
  path: string;
  outcome: ValidateRegistryOutcome;
  detail?: { code: string; message: string };
}

export interface ValidateRegistryData {
  results: ValidateRegistryEntryResult[];
}

export interface ValidateRegistryParams {
  registry: RegistryPort;
  manifest: ManifestPort;
  git: GitPort;
}

export interface ValidateCheckContext {
  path: string;
  manifest: Manifest;
  git: GitPort;
}

export type ValidateCheckResult =
  | { kind: 'valid' }
  | { kind: 'invalid'; code: string; message: string }
  | { kind: 'inconclusive'; code: string; message: string };

export interface ValidateCheck {
  name: string;
  run: (ctx: ValidateCheckContext) => Promise<ValidateCheckResult>;
}

// One-entry extensible check registry (Boundaries): a future second semantic check is a
// new entry here, not a rewrite of the loop, bucketing, CLI or screen wiring.
async function checkSharedBranchExists(ctx: ValidateCheckContext): Promise<ValidateCheckResult> {
  const { path, manifest, git } = ctx;
  const sharedBranch = manifest.sharedBranch;
  const local = await git.branchExistsLocally(path, sharedBranch);
  if (!local.ok) {
    return { kind: 'inconclusive', code: local.error.code, message: local.error.message };
  }
  if (local.data) {
    return { kind: 'valid' };
  }
  // Remote half anchored on origin/ only (Boundaries) — the only remote the adapter
  // fetches from. Never widen to */<branch> without renegotiation (Ask First).
  const remotes = await git.listRemoteBranches(path);
  if (!remotes.ok) {
    return { kind: 'inconclusive', code: remotes.error.code, message: remotes.error.message };
  }
  if (remotes.data.includes(`origin/${sharedBranch}`)) {
    return { kind: 'valid' };
  }
  return {
    kind: 'invalid',
    code: 'shared-branch-missing',
    message: `sharedBranch "${sharedBranch}" not found locally nor on origin`,
  };
}

const VALIDATE_CHECKS: readonly ValidateCheck[] = [{ name: 'sharedBranch', run: checkSharedBranchExists }];

export async function validateRegistry(params: ValidateRegistryParams): Promise<Result<ValidateRegistryData>> {
  const { registry, manifest, git } = params;

  const listed = await registry.list();
  if (!listed.ok) {
    return listed;
  }

  // Per-path isolation in registry-file order (Boundaries): one failure never blocks the
  // others, one outcome row per path.
  const results: ValidateRegistryEntryResult[] = [];
  for (const path of listed.data) {
    results.push(await validateOne(registry, manifest, git, path));
  }

  return ok({ results });
}

async function validateOne(
  registry: RegistryPort,
  manifest: ManifestPort,
  git: GitPort,
  path: string,
): Promise<ValidateRegistryEntryResult> {
  const exists = await registry.exists(path);
  if (!exists.ok) {
    return { path, outcome: 'inconclusive', detail: { code: exists.error.code, message: exists.error.message } };
  }
  if (!exists.data) {
    return { path, outcome: 'unreachable' };
  }

  const loaded = await manifest.load(path);
  if (!loaded.ok) {
    // Loader owns schema validation (Never) — surface its exact code + message.
    return { path, outcome: 'invalid', detail: { code: loaded.error.code, message: loaded.error.message } };
  }

  // Extensible check loop: every entry runs; an invalid beats an inconclusive, which
  // beats valid — so a future second entry slots in with no loop rewrite.
  let firstInconclusive: { code: string; message: string } | null = null;
  for (const check of VALIDATE_CHECKS) {
    const outcome = await check.run({ path, manifest: loaded.data, git });
    if (outcome.kind === 'invalid') {
      return { path, outcome: 'invalid', detail: { code: outcome.code, message: outcome.message } };
    }
    if (outcome.kind === 'inconclusive' && firstInconclusive === null) {
      firstInconclusive = { code: outcome.code, message: outcome.message };
    }
  }
  if (firstInconclusive !== null) {
    return { path, outcome: 'inconclusive', detail: firstInconclusive };
  }
  return { path, outcome: 'valid' };
}
