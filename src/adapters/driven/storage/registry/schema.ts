// adapters/driven/registry/schema: the zod schema for registry.yaml — a strict
// { repos: string[] } map (not a bare list) so future fields need no format migration. Paths
// must be absolute: a hand-edited relative entry would otherwise resolve against the process
// cwd, making output nondeterministic (FR-1).
import { z } from 'zod';
import { isAbsolute } from 'node:path';

export const registrySchema = z
  .object({
    repos: z.array(z.string().refine((path) => isAbsolute(path), 'registry stores only absolute paths')),
  })
  .strict();
