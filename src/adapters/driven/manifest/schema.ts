// adapters/driven/manifest/schema: the zod schema for a root .tui-back.yaml (AD-4).
// The loader safe-parses against this; the schema enforces the "every modules entry is
// a config object, never a bare boolean" invariant from the AD-4 architecture review.
// The explicit `z.ZodType<Manifest>` annotation is the type-level link between the schema
// and core's Manifest (zod 4.4.3 has no runtime `.satisfies()` method) — a field drift
// between the two fails typecheck in either direction.
import { z } from 'zod';
import type { Manifest } from '../../../core/ports/manifest.js';

export const moduleConfigSchema = z.record(z.string(), z.unknown());

export const manifestSchema: z.ZodType<Manifest> = z
  .object({
    service: z.string().trim().min(1),
    container: z.string().trim().min(1),
    migrationCommand: z.string().trim().min(1),
    sharedBranch: z.string().min(1).optional().default('development'),
    modules: z.record(z.string(), moduleConfigSchema),
  })
  .strict();
