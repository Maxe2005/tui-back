// adapters/driven/modules: the compiled-in static module registry (AD-5). Module
// implementations are statically registered here and selected by a manifest's `modules`
// key — never dynamically loaded from externally supplied paths. This story ships the
// mechanism only: the registry is empty because the real modules (route-explorer,
// shared-types-consumer) belong to Epics 6 and 4. Later epics add entries to
// `moduleRegistry`; the manifest adapter's membership check (and list-repos `moduleIds`)
// pick them up automatically via the derived `knownModuleIds` set.

export type ModuleId = string;

export interface ModuleImplementation {
  // Statically registered implementations fill in from Epics 4/6. The type staying a
  // placeholder lets an empty registry still type as the map later epics populate.
}

const EMPTY: Readonly<Record<ModuleId, ModuleImplementation>> = {};

export const moduleRegistry: Readonly<Record<ModuleId, ModuleImplementation>> = EMPTY;

export const knownModuleIds: ReadonlySet<ModuleId> = new Set(Object.keys(moduleRegistry));

export function isKnownModuleId(id: string): boolean {
  return knownModuleIds.has(id);
}

export function resolveModule(
  registry: Readonly<Record<ModuleId, ModuleImplementation>>,
  id: string,
): ModuleImplementation | undefined {
  return registry[id];
}

export function validateModules(
  modules: Record<string, unknown>,
  registry: Readonly<Record<ModuleId, ModuleImplementation>> = moduleRegistry,
): string[] {
  return Object.keys(modules).filter((id) => !Object.prototype.hasOwnProperty.call(registry, id));
}
