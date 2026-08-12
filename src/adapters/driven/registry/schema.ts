// adapters/driven/registry/schema: the zod schema for registry.yaml. A strict
// { repos: string[] } map (not a bare list) so future fields (e.g. per-path annotations)
// don't need a format migration — mirrors the manifest-schema conventions.
import { z } from 'zod';

export const registrySchema = z
  .object({
    repos: z.array(z.string()),
  })
  .strict();
