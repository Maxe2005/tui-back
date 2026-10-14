// core/logs/use-cases: the Result<T> entry points the TUI's logs slice calls — one per action,
// so the slice never calls LogsManager or DockerPort methods directly. Deliberately thin.
import { ok, type Result } from '../result.js';
import type { DockerPort, HealthState } from '../ports/docker.js';
import type { LogsManager } from './index.js';

export interface SubscribeLogsParams {
  manager: LogsManager;
  key: string;
  container: string;
  bufferSize: number;
  // Fires on every buffer/error change for this key — the slice's own hook into mirroring
  // LogsManager's state into the reactive Zustand store.
  onUpdate: () => void;
}

export function subscribeLogs(params: SubscribeLogsParams): Result<void> {
  return params.manager.subscribe(params.key, params.container, params.bufferSize, params.onUpdate);
}

export interface UnsubscribeLogsParams {
  manager: LogsManager;
  key: string;
}

export function unsubscribeLogs(params: UnsubscribeLogsParams): Result<void> {
  params.manager.unsubscribe(params.key);
  return ok(undefined);
}

export interface LoadOlderLogsParams {
  manager: LogsManager;
  key: string;
  container: string;
}

export function loadOlderLogs(params: LoadOlderLogsParams): Promise<Result<{ appended: number }>> {
  return params.manager.loadOlder(params.key, params.container);
}

export interface ClearLogsParams {
  manager: LogsManager;
  key: string;
}

export function clearLogs(params: ClearLogsParams): Result<void> {
  params.manager.clear(params.key);
  return ok(undefined);
}

export interface GetServiceHealthParams {
  docker: DockerPort;
  container: string;
}

// Thin Result<T> wrapper over DockerPort.getContainerHealth — keeps the TUI slice off the raw
// port, same as subscribeLogs/clearLogs keep it off LogsManager methods.
export function getServiceHealth(params: GetServiceHealthParams): Promise<Result<HealthState>> {
  return params.docker.getContainerHealth(params.container);
}
