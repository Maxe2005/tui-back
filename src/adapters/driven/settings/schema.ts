// adapters/driven/settings/schema: the zod schema for settings.yaml — `.strict()` with
// field-naming errors, like the manifest schema. Every top-level and nested key is optional
// and defaults to DEFAULT_SETTINGS' value, so an empty file (`{}` or a missing section) parses
// to the full default shape rather than failing.
import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS,
  MAX_FILTER_HISTORY_GRID_MAX_ROWS,
  MAX_INPUT_HISTORY_SIZE,
  MAX_GRID_MAX_ROWS,
  MAX_LOG_BUFFER_SIZE,
  MAX_UPDATE_CONCURRENCY,
  MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS,
  MIN_FILTER_HISTORY_GRID_MAX_ROWS,
  MIN_INPUT_HISTORY_SIZE,
  MIN_GRID_MAX_ROWS,
  MIN_LOG_BUFFER_SIZE,
  MIN_UPDATE_CONCURRENCY,
  type Settings,
} from '../../../core/ports/settings.js';

export const settingsSchema: z.ZodType<Settings> = z
  .object({
    general: z
      .object({
        quitShortcutEnabled: z.boolean().optional().default(DEFAULT_SETTINGS.general.quitShortcutEnabled),
        // Optional-with-default like every field added later: a settings.yaml written before
        // this field existed has a `general:` block without it, which must default to '' rather
        // than failing the whole file back to defaults.
        editorCommand: z.string().optional().default(DEFAULT_SETTINGS.general.editorCommand),
      })
      .strict()
      .optional()
      .default(DEFAULT_SETTINGS.general),
    commandPalette: z
      .object({
        gridMaxRows: z.number().int().min(MIN_GRID_MAX_ROWS).max(MAX_GRID_MAX_ROWS),
        // Optional-with-default so a settings.yaml that predates the history settings (gridMaxRows only)
        // still validates instead of discarding every customization.
        historySize: z
          .number()
          .int()
          .min(MIN_INPUT_HISTORY_SIZE)
          .max(MAX_INPUT_HISTORY_SIZE)
          .optional()
          .default(DEFAULT_SETTINGS.commandPalette.historySize),
        historyDedup: z.boolean().optional().default(DEFAULT_SETTINGS.commandPalette.historyDedup),
      })
      .strict()
      .optional()
      .default(DEFAULT_SETTINGS.commandPalette),
    edts: z
      .object({
        hiddenActionHints: z.array(z.string()).optional().default(DEFAULT_SETTINGS.edts.hiddenActionHints),
        // Must stay optional-with-default, never required: an older settings.yaml has an
        // `edts:` block with `hiddenActionHints` only. Requiring this key fails that whole
        // otherwise-valid file and silently discards every customization (hiddenActionHints,
        // commandPalette.gridMaxRows, ...) back to defaults.
        hiddenActionTypes: z.array(z.string()).optional().default(DEFAULT_SETTINGS.edts.hiddenActionTypes),
        // Branch autocomplete dropdown row count: optional-with-default for the same reason —
        // an older `edts:` block without this key must default to 5. Out-of-range/hand-edited
        // values fail validation as a unit, falling back to every default with a field-naming
        // warning.
        branchDropdownMaxRows: z
          .number()
          .int()
          .min(MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS)
          .max(MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS)
          .optional()
          .default(DEFAULT_SETTINGS.edts.branchDropdownMaxRows),
      })
      .strict()
      .optional()
      .default(DEFAULT_SETTINGS.edts),
    // Optional-with-default: a settings.yaml written before this group existed has no `update:`.
    update: z
      .object({
        concurrency: z
          .number()
          .int()
          .min(MIN_UPDATE_CONCURRENCY)
          .max(MAX_UPDATE_CONCURRENCY)
          .optional()
          .default(DEFAULT_SETTINGS.update.concurrency),
      })
      .strict()
      .optional()
      .default(DEFAULT_SETTINGS.update),
    // An invalid `logs.bufferSize` does not just reset this `logs` block: the whole top-level
    // `.strict()` object fails validation as one unit, so *every* top-level key falls back to
    // DEFAULT_SETTINGS, like any other invalid field in this schema (index.test.ts's
    // field-naming-warning tests assert the entire DEFAULT_SETTINGS).
    logs: z
      .object({
        bufferSize: z.number().int().min(MIN_LOG_BUFFER_SIZE).max(MAX_LOG_BUFFER_SIZE),
        startWithHistory: z.boolean().optional().default(DEFAULT_SETTINGS.logs.startWithHistory),
        // Optional-with-default like startWithHistory above — an older settings.yaml's `logs:`
        // block predates both fields.
        filterHistorySize: z
          .number()
          .int()
          .min(MIN_INPUT_HISTORY_SIZE)
          .max(MAX_INPUT_HISTORY_SIZE)
          .optional()
          .default(DEFAULT_SETTINGS.logs.filterHistorySize),
        filterHistoryGridMaxRows: z
          .number()
          .int()
          .min(MIN_FILTER_HISTORY_GRID_MAX_ROWS)
          .max(MAX_FILTER_HISTORY_GRID_MAX_ROWS)
          .optional()
          .default(DEFAULT_SETTINGS.logs.filterHistoryGridMaxRows),
        filterHistoryDedup: z.boolean().optional().default(DEFAULT_SETTINGS.logs.filterHistoryDedup),
        // An unknown value falls back to `simple` on its own rather than invalidating the file.
        restartMode: z.enum(['simple', 'clean']).catch('simple').optional().default(DEFAULT_SETTINGS.logs.restartMode),
      })
      .strict()
      .optional()
      .default(DEFAULT_SETTINGS.logs),
  })
  .strict();
