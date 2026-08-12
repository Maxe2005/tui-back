// adapters/driven/registry/schema: the zod schema for registry.yaml. A strict
// { repos: string[] } map (not a bare list) so future fields (e.g. per-path annotations)
// don't need a format migration — mirrors the manifest-schema conventions. Paths must be
// absolute: the registry stores only absolute paths (register rejects relative ones), so
// a hand-edited relative entry would otherwise be resolved against the process cwd —
// nondeterministic output violating FR-1 idempotency.
import { z } from 'zod';
import { isAbsolute } from 'node:path';

export const registrySchema = z
  .object({
    repos: z.array(z.string().refine((path) => isAbsolute(path), 'registry stores only absolute paths')),
  })
  .strict();
