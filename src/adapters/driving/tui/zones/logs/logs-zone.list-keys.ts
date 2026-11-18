// tui/zones/logs: logs-zone.list-keys — keys of the two service lists (active-EDT members, other
// services): select-all, cursor moves, checkbox toggle, Enter to open fullscreen.
import { isSelectAllKey, resolveSelectAllToggle } from './logs-zone.logic.js';
import { jumpSelection, moveSelection, resolveSelectionDirection, resolveSelectionJump } from '../../shared/keys/list-cursor.js';
import type { LogsKey, LogsZoneCtx } from './logs-zone.ctx.js';

export function handleEdtListKey(c: LogsZoneCtx, input: string, key: LogsKey): void {
  const { clampedEdtCursor, deselectAllLogsEdtServices, edtServices, logsEdtSelected, openLogsFullscreen, selectAllLogsEdtServices, setEdtCursor, toggleLogsEdtSelection } = c;
  if (isSelectAllKey(input, key)) {
    const edtPaths = edtServices.map((service) => service.path);
    if (resolveSelectAllToggle(edtPaths, logsEdtSelected) === 'select-all') {
      selectAllLogsEdtServices(edtPaths);
    } else {
      deselectAllLogsEdtServices();
    }
    return;
  }
  const jump = resolveSelectionJump(key);
  if (jump !== null) {
    setEdtCursor(jumpSelection(jump, edtServices.length));
    return;
  }
  const direction = resolveSelectionDirection(key);
  if (direction !== null) {
    setEdtCursor((current) => moveSelection(current, direction, edtServices.length));
    return;
  }
  if (input === ' ') {
    const service = edtServices[clampedEdtCursor];
    if (service !== undefined) {
      toggleLogsEdtSelection(service.path);
    }
    return;
  }
  if (key.return) {
    const service = edtServices[clampedEdtCursor];
    if (service !== undefined) {
      openLogsFullscreen(service.path, service.service);
    }
  }
}

export function handleOtherListKey(c: LogsZoneCtx, input: string, key: LogsKey): void {
  const { clampedOtherCursor, deselectAllLogsOtherServices, logsOtherSelected, openLogsFullscreen, otherServices, selectAllLogsOtherServices, setOtherCursor, toggleLogsOtherSelection } = c;
  // Ctrl+A is scoped to the focused list only — the EDT-members list, the third
  // section, and the other list's own unselected rows are never touched from here.
  if (isSelectAllKey(input, key)) {
    const otherPaths = otherServices.map((service) => service.path);
    if (resolveSelectAllToggle(otherPaths, logsOtherSelected) === 'select-all') {
      selectAllLogsOtherServices(otherPaths);
    } else {
      deselectAllLogsOtherServices();
    }
    return;
  }
  const jump = resolveSelectionJump(key);
  if (jump !== null) {
    setOtherCursor(jumpSelection(jump, otherServices.length));
    return;
  }
  const direction = resolveSelectionDirection(key);
  if (direction !== null) {
    setOtherCursor((current) => moveSelection(current, direction, otherServices.length));
    return;
  }
  if (input === ' ') {
    const service = otherServices[clampedOtherCursor];
    if (service !== undefined) {
      toggleLogsOtherSelection(service.path);
    }
    return;
  }
  if (key.return) {
    const service = otherServices[clampedOtherCursor];
    if (service !== undefined) {
      openLogsFullscreen(service.path, service.service);
    }
  }
}
