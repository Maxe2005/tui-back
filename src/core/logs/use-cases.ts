// core/logs/use-cases: the Result<T> boundary (AD-2/AD-3) the TUI's logs slice calls, mirroring
// how core/edt/{create,switch,modify}.ts sit between the store and their own stateful
// dependency. LogsManager (index.ts) already returns Result<T> itself — these three functions
// stay thin on purpose, giving the slice one canonical entry point per action (never calling
// manager methods directly) exactly like the EDT slice never calls EdtRegistryPort methods
// directly for create/switch/modify.
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

// Story 5.3: thin Result<T> wrapper over DockerPort.getContainerHealth — keeps the TUI
// slice off the raw port, same as subscribeLogs/clearLogs keep it off LogsManager methods.
export function getServiceHealth(params: GetServiceHealthParams): Promise<Result<HealthState>> {
  return params.docker.getContainerHealth(params.container);
}

export interface RestartServiceParams {
  docker: DockerPort;
  container: string;
}

// Story 5.3: thin Result<T> wrapper over DockerPort.restartContainer — developer-triggered
// only, never called automatically (replaces check_health.sh's auto-restart).
export function restartService(params: RestartServiceParams): Promise<Result<void>> {
  return params.docker.restartContainer(params.container);
}
