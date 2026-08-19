// adapters/driven/state/schema: the zod schema for state.json (AD-7/AD-10). Strict on
// purpose, mirroring edt-registry/schema.ts's convention — this story only models the
// `activeEdt` pointer; future stories that add more transient UI state (splitter sizes,
// scroll position — AD-7) evolve this schema in place, hand-rolled, the same way
// edts.yaml's shape evolved in story 2.2.
import { z } from 'zod';

export const stateSchema = z
  .object({
    activeEdt: z.string().min(1).nullable(),
  })
  .strict();
