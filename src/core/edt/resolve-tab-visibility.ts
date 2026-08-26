// core/edt/resolve-tab-visibility: story 2.13 — computes each manifest-gated zone tab's
// visibility status (`omitted`/`disabled`/`enabled`) by cross-referencing every *registered*
// repo's manifest module ids (core/scripts/list-repos.ts's registry-wide `moduleIds` scan)
// against *active-EDT* membership (mirrors core/edt/list.ts:75-89's active-EDT-member-path
// resolution) — no duplicated manifest loop, no duplicated active-EDT resolution.
//
// `Routes` gates on `route-explorer`; `shared-types` gates on `shared-types-source` OR
// `shared-types-consumer` (either counts, for both omission and disabled) — per the spec's
// Boundaries & Constraints. `module-registry.ts` stays empty (human-confirmed scope): these
// module ids are matched only against whatever a manifest happens to declare, never
// validated against the compiled-in module registry here — real usage keeps both gated
// zones `omitted` until Epic 4/6 register real modules; `disabled`/`enabled` are exercised
// only via injected port fixtures in tests.
import { resolve } from 'node:path';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { ok, type Result } from '../result.js';
import { listRepos, type ManagedRepo } from '../scripts/list-repos.js';

export const ROUTES_MODULE_ID = 'route-explorer';
export const SHARED_TYPES_MODULE_IDS = ['shared-types-source', 'shared-types-consumer'] as const;

export type GatedTabStatus = 'omitted' | 'disabled' | 'enabled';

export interface GatedTabVisibility {
  status: GatedTabStatus;
  // The registry-wide services that declare the gating module — always populated whenever
  // status !== 'omitted' (a `disabled` tab's explanatory message names them; `enabled` keeps
  // them too, for symmetry/testability), empty for `omitted` (there is nothing to name).
  carryingServices: string[];
}

export interface ResolveTabVisibilityData {
  routes: GatedTabVisibility;
  sharedTypes: GatedTabVisibility;
}

// The single source of truth for the pre-load / unwired-store default (Boundaries: "default
// reachable state") — both gated tabs render 'enabled', never 'omitted' (which would hide,
// then re-show, a tab once the real load resolves) and never 'disabled' (which would falsely
// dim a tab before its real status is known). Shared by app-store.ts (the pre-load store
// default) and zone-tab-bar.tsx (the default for callers that don't care about
// manifest-gating) so the literal is defined once.
export const DEFAULT_TAB_VISIBILITY: ResolveTabVisibilityData = {
  routes: { status: 'enabled', carryingServices: [] },
  sharedTypes: { status: 'enabled', carryingServices: [] },
};

export interface ResolveTabVisibilityParams {
  registry: RegistryPort;
  manifest: ManifestPort;
  edtRegistry: EdtRegistryPort;
  state: StatePort;
}

export async function resolveTabVisibility(
  params: ResolveTabVisibilityParams,
): Promise<Result<ResolveTabVisibilityData>> {
  const { registry, manifest, edtRegistry, state } = params;

  const listed = await listRepos(registry, manifest);
  if (!listed.ok) {
    return listed;
  }

  // Mirrors core/edt/list.ts:75-89 exactly: resolve the active EDT's member repo paths
  // purely to decide disabled-vs-enabled below — never to source a branch/identity value.
  const activeUlid = await state.readActiveEdt();
  if (!activeUlid.ok) {
    return activeUlid;
  }

  let activeMemberPaths = new Set<string>();
  if (activeUlid.data !== null) {
    const edts = await edtRegistry.list();
    if (!edts.ok) {
      return edts;
    }
    const active = edts.data.find((candidate) => candidate.ulid === activeUlid.data);
    if (active !== undefined) {
      activeMemberPaths = new Set(active.members.map((member) => resolve(member.repoPath)));
    }
  }

  return ok({
    routes: resolveGatedTab(listed.data.repos, [ROUTES_MODULE_ID], activeMemberPaths),
    sharedTypes: resolveGatedTab(listed.data.repos, [...SHARED_TYPES_MODULE_IDS], activeMemberPaths),
  });
}

function resolveGatedTab(
  repos: ManagedRepo[],
  gatingModuleIds: readonly string[],
  activeMemberPaths: ReadonlySet<string>,
): GatedTabVisibility {
  const carrying = repos.filter((repo) => repo.moduleIds.some((id) => gatingModuleIds.includes(id)));
  if (carrying.length === 0) {
    // Zero registry-wide repos activate the module — fully omitted, regardless of EDT state.
    return { status: 'omitted', carryingServices: [] };
  }
  const carryingServices = carrying.map((repo) => repo.service);
  const hasActiveMember = carrying.some((repo) => activeMemberPaths.has(resolve(repo.path)));
  return { status: hasActiveMember ? 'enabled' : 'disabled', carryingServices };
}
