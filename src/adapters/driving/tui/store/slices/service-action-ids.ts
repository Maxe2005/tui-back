// tui/store/slices: how the service-action registry's ids map onto behaviour — which restart
// mode an id runs and which terminal it opens. Every consumer reads these maps, so an id is
// never interpreted two ways.
import type { RestartMode } from '../../../../../core/service-actions/index.js';
import type { TerminalKind } from './terminal-slice.js';

export const RESTART_MODES: Readonly<Record<string, RestartMode>> = {
  'restart-simple': 'simple',
  'restart-clean': 'clean',
};

// The registry's terminal entries open the Terminal overlay on the service's repo or container.
export const TERMINAL_KINDS: Readonly<Record<string, TerminalKind>> = {
  'terminal-service': 'service',
  'terminal-container': 'container',
};

// The registry entry each restart mode runs (the inverse of RESTART_MODES).
export const RESTART_ACTION_IDS: Readonly<Record<RestartMode, string>> = {
  simple: 'restart-simple',
  clean: 'restart-clean',
};

export const OPEN_IN_IDE_ACTION_ID = 'open-in-ide';
