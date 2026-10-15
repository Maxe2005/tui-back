// adapters/driven/modules: the compiled-in static module registry (AD-5). Modules are
// registered here and selected by a manifest's `modules` key — never loaded dynamically from
// external paths. `route-explorer` bundles the nestjs-openapi scanner and the cookie-session
// auth. The manifest membership check and list-repos read the derived `knownModuleIds`.
import { createNestjsOpenApiScanner } from './route-explorer/nestjs-openapi.js';
import { createCookieSessionAuth } from './route-explorer/cookie-session-auth.js';
import type { DevAuthPort } from '../../../core/ports/dev-auth.js';
import type { RouteScannerPort } from '../../../core/ports/route-scanner.js';
import type { SharedTypesPort } from '../../../core/ports/shared-types.js';
import type { ZodTypeAny } from 'zod';
import { createSharedTypesAdapter } from './shared-types/npm-package.js';
import { sharedTypesConsumerConfigSchema, sharedTypesSourceConfigSchema } from './shared-types/config.js';

export type ModuleId = string;

export interface RouteExplorerModule {
  kind: 'route-explorer';
  scanner: RouteScannerPort;
  auth?: DevAuthPort;
  configSchema?: ZodTypeAny;
}

export interface SharedTypesModule {
  kind: 'shared-types';
  shared: SharedTypesPort;
  // Validates and defaults the module's manifest parameters (strict: unknown ones rejected).
  configSchema: ZodTypeAny;
}

export type ModuleImplementation = RouteExplorerModule | SharedTypesModule;

const sharedTypesAdapter = createSharedTypesAdapter();

export const moduleRegistry: Readonly<Record<ModuleId, ModuleImplementation>> = {
  'route-explorer': {
    kind: 'route-explorer',
    scanner: createNestjsOpenApiScanner(),
    auth: createCookieSessionAuth(),
  },
  'shared-types-source': {
    kind: 'shared-types',
    shared: sharedTypesAdapter,
    configSchema: sharedTypesSourceConfigSchema,
  },
  'shared-types-consumer': {
    kind: 'shared-types',
    shared: sharedTypesAdapter,
    configSchema: sharedTypesConsumerConfigSchema,
  },
};

// Per-module manifest parameter schemas, derived from the registry so the manifest schema
// stays generic and never names a module.
export const moduleConfigSchemas: Readonly<Record<ModuleId, ZodTypeAny>> = Object.fromEntries(
  Object.entries(moduleRegistry).flatMap(([id, impl]) => (impl.configSchema ? [[id, impl.configSchema]] : [])),
);

export const knownModuleIds: ReadonlySet<ModuleId> = new Set(Object.keys(moduleRegistry));

export function isKnownModuleId(id: string): boolean {
  return knownModuleIds.has(id);
}

// Generic over the value type so tests can exercise populated maps without importing a
// production module implementation — callers pass their own registry; the default is the
// production one above.
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
