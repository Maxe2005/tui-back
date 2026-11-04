// core/service-status: the single owner of AD-23 — the health-first rule every displayed service
// state comes from (Dashboard, Logs, Update, CLI `dashboard`). The manifest `healthUrl` is probed
// first, then its outcome is combined with the container state. The combination table lives only
// in `combineStatus`; a new probe kind is added here, never in a consumer. Ports are injected and
// nothing here rejects: every failure comes back as a `Result`.
import { getServiceHealth } from '../logs/use-cases.js';
import type { DockerPort, HealthState } from '../ports/docker.js';
import type { HealthProbePort } from '../ports/health-probe.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import { err, ok, type Result } from '../result.js';

// A steady-state status probe never waits longer than this: the polls must stay responsive.
export const STATUS_PROBE_TIMEOUT_MS = 2000;

export type ServiceStatusState = 'up' | 'unhealthy' | 'inconsistent' | 'restarting' | 'down' | 'no-container';

export interface ServiceStatus {
  state: ServiceStatusState;
  // True when the state was decided with a health probe (a `healthUrl` was declared and probed);
  // a plain container `up` without a route is unverified.
  verified: boolean;
  // The raw container state, `no-container` when none is declared, null when Docker failed.
  container: HealthState | 'no-container' | null;
  // Docker's error when the container read failed but the probe still decided the state.
  containerError?: { code: string; message: string };
  // Why the health probe did not answer 2xx.
  probeReason?: string;
}

// The health probe outcome, in the resolver's terms: none declared, a 2xx, or anything else.
export type ProbeReading = { kind: 'none' } | { kind: 'healthy' } | { kind: 'failed'; reason: string };

// The container read: none declared, a state, or a Docker error.
export type ContainerReading =
  | { kind: 'none' }
  | { kind: 'state'; state: HealthState }
  | { kind: 'error'; error: { code: string; message: string } };

export interface ServiceStatusDeps {
  manifest: ManifestPort;
  docker: Pick<DockerPort, 'getContainerHealth'>;
  // Not wired = behaves as if no `healthUrl` were declared.
  healthProbe?: HealthProbePort;
}

export const DEFAULT_PROBE_REASON = 'health route did not answer 2xx';

export function hasContainer(manifest: Manifest): boolean {
  return manifest.container !== undefined && manifest.container.trim() !== '';
}

export function hasHealthUrl(manifest: Manifest): boolean {
  return manifest.healthUrl !== undefined && manifest.healthUrl.trim() !== '';
}

// The AD-23 combination table. Pure: the one place probe and container are combined.
export function combineStatus(probe: ProbeReading, container: ContainerReading): Result<ServiceStatus> {
  const raw: Pick<ServiceStatus, 'container' | 'containerError'> =
    container.kind === 'none'
      ? { container: 'no-container' }
      : container.kind === 'state'
        ? { container: container.state }
        : { container: null, containerError: { code: container.error.code, message: container.error.message } };

  if (probe.kind === 'none') {
    if (container.kind === 'error') {
      return err(container.error.code, container.error.message);
    }
    return ok({ state: container.kind === 'none' ? 'no-container' : container.state, verified: false, ...raw });
  }

  if (probe.kind === 'healthy') {
    // A Docker outage never makes a service that answers `inconsistent`.
    if (container.kind === 'state' && container.state !== 'up') {
      return ok({ state: 'inconsistent', verified: true, ...raw });
    }
    return ok({ state: 'up', verified: true, ...raw });
  }

  const probeReason = probe.reason;
  switch (container.kind) {
    case 'none':
      return ok({ state: 'down', verified: true, ...raw, probeReason });
    case 'error':
      return err(container.error.code, container.error.message, { probeReason });
    case 'state':
      return ok({ state: container.state === 'up' ? 'unhealthy' : container.state, verified: true, ...raw, probeReason });
  }
}

// Probes the declared route and reads the container in parallel, then combines them.
export async function resolveManifestStatus(deps: Omit<ServiceStatusDeps, 'manifest'>, manifest: Manifest, probeTimeoutMs = STATUS_PROBE_TIMEOUT_MS): Promise<Result<ServiceStatus>> {
  const [probe, container] = await Promise.all([readProbe(deps, manifest, probeTimeoutMs), readContainer(deps, manifest)]);
  return combineStatus(probe, container);
}

export async function resolveServiceStatus(deps: ServiceStatusDeps, repoPath: string): Promise<Result<ServiceStatus>> {
  if (repoPath.trim() === '') {
    return err('invalid-argument', 'repoPath must not be empty — pass the service repo directory');
  }
  let loaded: Result<Manifest>;
  try {
    loaded = await deps.manifest.load(repoPath);
  } catch (cause) {
    return err('manifest-error', messageOf(cause));
  }
  if (!loaded.ok) {
    return loaded;
  }
  return resolveManifestStatus(deps, loaded.data);
}

export async function readProbe(deps: Pick<ServiceStatusDeps, 'healthProbe'>, manifest: Manifest, timeoutMs: number): Promise<ProbeReading> {
  const { healthProbe } = deps;
  if (healthProbe === undefined || !hasHealthUrl(manifest) || manifest.healthUrl === undefined) {
    return { kind: 'none' };
  }
  try {
    const probed = await healthProbe.probe(manifest.healthUrl.trim(), timeoutMs);
    if (!probed.ok) {
      return { kind: 'failed', reason: probed.error.message };
    }
    return probed.data.healthy ? { kind: 'healthy' } : { kind: 'failed', reason: probed.data.reason ?? DEFAULT_PROBE_REASON };
  } catch (cause) {
    return { kind: 'failed', reason: messageOf(cause) };
  }
}

export async function readContainer(deps: Pick<ServiceStatusDeps, 'docker'>, manifest: Manifest): Promise<ContainerReading> {
  if (!hasContainer(manifest) || manifest.container === undefined) {
    return { kind: 'none' };
  }
  try {
    const health = await getServiceHealth({ docker: deps.docker, container: manifest.container.trim() });
    return health.ok ? { kind: 'state', state: health.data } : { kind: 'error', error: { code: health.error.code, message: health.error.message } };
  } catch (cause) {
    return { kind: 'error', error: { code: 'docker-unavailable', message: messageOf(cause) } };
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
