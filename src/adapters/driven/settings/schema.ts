// adapters/driven/settings/schema: the zod schema for settings.yaml (Story 2.19). Mirrors
// adapters/driven/manifest/schema.ts's `.strict()` + field-naming-error convention: every
// top-level and nested key is optional and defaults to DEFAULT_SETTINGS' value, so an empty
// file (`{}` or a missing section) parses to the full default shape rather than failing.
import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  MAX_GRID_MAX_ROWS,
  MAX_LOG_BUFFER_SIZE,
  MIN_GRID_MAX_ROWS,
  MIN_LOG_BUFFER_SIZE,
  type Settings,
} from '../../../core/ports/settings.js';

export const settingsSchema: z.ZodType<Settings> = z
  .object({
    commandPalette: z
      .object({
        gridMaxRows: z.number().int().min(MIN_GRID_MAX_ROWS).max(MAX_GRID_MAX_ROWS),
      })
      .strict()
      .optional()
      .default(DEFAULT_SETTINGS.commandPalette),
    edts: z
      .object({
        hiddenActionHints: z.array(z.string()).optional().default(DEFAULT_SETTINGS.edts.hiddenActionHints),
        // Field added 2026-08-28 (Sprint Change Proposal): must stay optional-with-default, not
        // required — a settings.yaml written by the pre-amendment code has an `edts:` block
        // with `hiddenActionHints` only, no `hiddenActionTypes` key at all. Requiring it here
        // made that pre-existing, otherwise-valid file fail validation as a whole (confirmed in
        // real usage: it fell back to every default, silently discarding the developer's
        // existing hiddenActionHints and commandPalette.gridMaxRows customizations too, not
        // just the missing field), which is exactly the file header's own "every top-level and
        // nested key is optional... so ... parses to the full default shape rather than
        // failing" convention this violated.
        hiddenActionTypes: z.array(z.string()).optional().default(DEFAULT_SETTINGS.edts.hiddenActionTypes),
      })
      .strict()
      .optional()
      .default(DEFAULT_SETTINGS.edts),
    // Story 5.1: keeps a corrupt/out-of-range settings.yaml non-blocking (existing guarantee).
    // Per this file's own `.strict()` + `.default()`-per-top-level-key convention, an invalid
    // `logs.bufferSize` does not just reset this `logs` block — the whole top-level `.strict()`
    // object fails validation as one unit, so *every* top-level key (commandPalette, edts, logs)
    // falls back to DEFAULT_SETTINGS, exactly like an invalid commandPalette.gridMaxRows or an
    // unknown top-level field does elsewhere in this schema (see index.test.ts's "falls back to
    // defaults with a field-naming warning..." tests, all of which assert the *entire*
    // DEFAULT_SETTINGS, not just one block).
    logs: z
      .object({
        bufferSize: z.number().int().min(MIN_LOG_BUFFER_SIZE).max(MAX_LOG_BUFFER_SIZE),
      })
      .strict()
      .optional()
      .default(DEFAULT_SETTINGS.logs),
  })
  .strict();
