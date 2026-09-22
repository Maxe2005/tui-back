// adapters/driven/modules: the compiled-in static module registry (AD-5). Module
// implementations are statically registered here and selected by a manifest's `modules`
// key — never dynamically loaded from externally supplied paths. Story 6.1 registers the
// first real module: `route-explorer` (the nestjs-openapi RouteScannerPort implementation
// from Epic 6's backend). The manifest adapter's membership check (and list-repos
// `moduleIds`) pick it up automatically via the derived `knownModuleIds` set.
import { createNestjsOpenApiScanner } from './route-explorer/nestjs-openapi.js';
import type { RouteScannerPort } from '../../../core/ports/route-scanner.js';

export type ModuleId = string;

export interface ModuleImplementation {
  kind: string;
  scanner: RouteScannerPort;
}

export const moduleRegistry: Readonly<Record<ModuleId, ModuleImplementation>> = {
  'route-explorer': { kind: 'route-explorer', scanner: createNestjsOpenApiScanner() },
};

export const knownModuleIds: ReadonlySet<ModuleId> = new Set(Object.keys(moduleRegistry));

export function isKnownModuleId(id: string): boolean {
  return knownModuleIds.has(id);
}

// Generic over the value type so tests can exercise populated maps without importing a
// production module implementation (Design Notes decision D1) — callers pass their own
// registry; the default is the production one above.
export function resolveModule<T>(registry: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(registry, id) ? registry[id] : undefined;
}

export function validateModules<T>(
  modules: Record<string, unknown>,
  registry: Readonly<Record<string, T>> = moduleRegistry as Readonly<Record<string, T>>,
): string[] {
  return Object.keys(modules)
    .sort()
    .filter((id) => !Object.prototype.hasOwnProperty.call(registry, id));
}
