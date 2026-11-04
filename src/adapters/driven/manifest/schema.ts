// adapters/driven/manifest/schema: the zod schema for a root .tui-back.yaml (AD-4). Every
// `modules` entry is a config object, never a bare boolean, and every key must be a known,
// compiled-in module id (AD-5) — unknown ids are surfaced, never ignored. The explicit
// `z.ZodType<Manifest>` annotation ties the schema to core's Manifest (zod has no runtime
// `.satisfies()`), so a field drift fails typecheck in either direction.
import { z } from 'zod';
import type { Manifest } from '../../../core/ports/manifest.js';
import { knownModuleIds, moduleConfigSchemas } from '../modules/module-registry.js';

export const moduleConfigSchema = z.record(z.string(), z.unknown());

export function createManifestSchema(
  known: ReadonlySet<string>,
  configSchemas: Readonly<Record<string, z.ZodTypeAny>> = moduleConfigSchemas,
): z.ZodType<Manifest> {
  return z
    .object({
      service: z.string().trim().min(1),
      container: z.string().trim().min(1).optional(),
      // Optional; a non-blank http:// or https:// URL — the steady-state status probe (AD-23,
      // core/service-status), also used to verify a post-switch restart.
      healthUrl: z
        .string()
        .trim()
        .min(1)
        .refine((value) => /^https?:\/\/\S+$/i.test(value), {
          message: 'healthUrl must be a non-blank http:// or https:// URL',
        })
        .optional(),
      migrationCommand: z.string().trim().min(1).optional(),
      restartCommands: z.array(z.string().trim().min(1)).optional(),
      sharedBranch: z.string().min(1).optional().default('development'),
      // Optional; each entry trimmed and non-empty, duplicates tolerated.
      protectedBranches: z.array(z.string().trim().min(1)).optional(),
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
          continue;
        }
        // A module that declares a parameter schema gets its config validated (strict,
        // blanks rejected); the defaulted result is applied by the transform below.
        const configSchema = Object.prototype.hasOwnProperty.call(configSchemas, id) ? configSchemas[id] : undefined;
        if (configSchema) {
          const parsed = configSchema.safeParse(config);
          if (!parsed.success) {
            for (const issue of parsed.error.issues) {
              const param = issue.path.length > 0 ? ` parameter "${issue.path.map(String).join('.')}"` : '';
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['modules', id, ...issue.path],
                message: `Invalid config for module "${id}"${param}: ${issue.message}`,
              });
            }
          }
        }
      }
    })
    .transform((value) => {
      const modules: Record<string, Record<string, unknown>> = {};
      for (const [id, config] of Object.entries(value.modules)) {
        const configSchema = Object.prototype.hasOwnProperty.call(configSchemas, id) ? configSchemas[id] : undefined;
        modules[id] = configSchema ? (configSchema.parse(config) as Record<string, unknown>) : config;
      }
      return { ...value, modules };
    });
}

export const manifestSchema: z.ZodType<Manifest> = createManifestSchema(knownModuleIds);
