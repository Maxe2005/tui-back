// adapters/driven/state/schema: the zod schema for state.json (AD-7/AD-10). Strict on
// purpose, mirroring edt-registry/schema.ts's convention — this story only models the
// `activeEdt` pointer; future stories that add more transient UI state (splitter sizes,
// scroll position — AD-7) evolve this schema in place, hand-rolled, the same way
// edts.yaml's shape evolved in story 2.2.
//
// Story 2.21: adds `splitterRatios`, optional so a pre-2.21 file (`{ activeEdt }` only) still
// validates. Keyed by zone id (a plain string here — the TUI's ZoneId narrowing/defaulting
// happens in the driving layer, not here). Per-zone array-length mismatches (e.g. the EDTs
// zone's 3-boundary array coming back with only 1 entry) are a semantic, not a shape,
// validation — the driving layer's loadSplitterRatios() falls back to that zone's own default
// silently rather than this schema rejecting the whole file over it.
//
// Story 5.4: adds `filterHistory`, optional the same way — a pre-5.4 file has neither key at
// all. Keyed by a plain string (the driving layer's filterHistoryKeyString), each value an
// ordered array of plain query strings.
import { z } from 'zod';

export const stateSchema = z
  .object({
    activeEdt: z.string().min(1).nullable(),
    splitterRatios: z.record(z.string(), z.array(z.number())).optional(),
    filterHistory: z.record(z.string(), z.array(z.string())).optional(),
  })
  .strict();
