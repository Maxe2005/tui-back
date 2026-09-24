// adapters/driven/manifest/schema: the zod schema for a root .tui-back.yaml (AD-4).
// The loader safe-parses against this; the schema enforces the "every modules entry is
// a config object, never a bare boolean" invariant from the AD-4 architecture review,
// and Story 1.6 adds a module-id membership check (AD-5): every key in a manifest's
// `modules` map must be a known, compiled-in module id. Unknown ids are surfaced, never
// silently ignored.
//
// The explicit `z.ZodType<Manifest>` annotation is the type-level link between the schema
// and core's Manifest (zod 4.4.3 has no runtime `.satisfies()` method) — a field drift
// between the two fails typecheck in either direction.
import { z } from 'zod';
import type { Manifest } from '../../../core/ports/manifest.js';
import { knownModuleIds } from '../modules/module-registry.js';

export const moduleConfigSchema = z.record(z.string(), z.unknown());

export function createManifestSchema(known: ReadonlySet<string>): z.ZodType<Manifest> {
  return z
    .object({
      service: z.string().trim().min(1),
      container: z.string().trim().min(1),
      migrationCommand: z.string().trim().min(1).optional(),
      restartCommands: z.array(z.string().trim().min(1)).optional(),
      sharedBranch: z.string().min(1).optional().default('development'),
      modules: z.record(z.string(), moduleConfigSchema),
    })
    .strict()
    .superRefine((value, ctx) => {
      const modules = value.modules;
      if (modules === undefined) {
        return;
      }
      // Keys are visited in sorted order so which key is reported first is deterministic
      // (FR-1). The membership check only applies to well-formed config objects: the
      // value-shape check (moduleConfigSchema) owns errors for a bare boolean/array/null,
      // so we skip those keys here and never double-report them.
      for (const id of Object.keys(modules).sort()) {
        const config = modules[id];
        if (!known.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['modules', id],
            message: `Unknown module id "${id}"`,
          });
        }
      }
    });
}

export const manifestSchema: z.ZodType<Manifest> = createManifestSchema(knownModuleIds);
