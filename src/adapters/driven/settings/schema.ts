// adapters/driven/settings/schema: the zod schema for settings.yaml (Story 2.19). Mirrors
// adapters/driven/manifest/schema.ts's `.strict()` + field-naming-error convention: every
// top-level and nested key is optional and defaults to DEFAULT_SETTINGS' value, so an empty
// file (`{}` or a missing section) parses to the full default shape rather than failing.
import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  MAX_GRID_MAX_ROWS,
  MIN_GRID_MAX_ROWS,
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
        hiddenActionHints: z.array(z.string()),
        hiddenActionTypes: z.array(z.string()),
      })
      .strict()
      .optional()
      .default(DEFAULT_SETTINGS.edts),
  })
  .strict();
