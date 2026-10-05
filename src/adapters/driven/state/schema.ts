// adapters/driven/state/schema: the zod schema for state.json (AD-7/AD-10) — strict, with
// optional `splitterRatios` and `filterHistory` so older files still validate. Both are keyed
// by plain strings (zone ids, filter-history keys) narrowed in the driving layer. A per-zone
// ratio array of the wrong length is a semantic issue the driving layer defaults per zone,
// never a reason to reject the whole file.
import { z } from 'zod';

export const stateSchema = z
  .object({
    activeEdt: z.string().min(1).nullable(),
    splitterRatios: z.record(z.string(), z.array(z.number())).optional(),
    filterHistory: z.record(z.string(), z.array(z.string())).optional(),
  })
  .strict();
