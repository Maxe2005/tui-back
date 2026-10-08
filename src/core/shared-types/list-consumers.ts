// core/shared-types/list-consumers: resolves the active EDT's version-consuming services from
// their manifests. Core never names the module: the caller passes the consuming module's id and
// a `parseConfig` seam that validates/defaults its manifest parameters (the schema lives in the
// driven module registry, which core must not import).
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { StatePort } from '../ports/state.js';
import { ok, type Result } from '../result.js';

export interface DependencyConsumerConfig {
  dependency: string;
  packageJsonPath: string;
}

export interface DependencyConsumer extends DependencyConsumerConfig {
  service: string;
  repoPath: string;
  // The branch the active EDT records for this service.
  branch: string;
}

export interface ConsumerIssue {
  service: string;
  repoPath: string;
  message: string;
}

export interface ListConsumersData {
  consumers: DependencyConsumer[];
  // Members that declare the module but could not be resolved (bad parameters) — surfaced,
  // never silently dropped.
  issues: ConsumerIssue[];
}

export type ConsumerConfigParser = (raw: Record<string, unknown>) => Result<DependencyConsumerConfig>;

export interface ListConsumersParams {
  edtRegistry: EdtRegistryPort;
  manifest: ManifestPort;
  state: StatePort;
  moduleId: string;
  parseConfig: ConsumerConfigParser;
}

export async function listConsumers(params: ListConsumersParams): Promise<Result<ListConsumersData>> {
  const { edtRegistry, manifest, state, moduleId, parseConfig } = params;
  const activeUlid = await state.readActiveEdt();
  if (!activeUlid.ok) {
    return activeUlid;
  }
  if (activeUlid.data === null) {
    return ok({ consumers: [], issues: [] });
  }
  const edts = await edtRegistry.list();
  if (!edts.ok) {
    return edts;
  }
  const active = edts.data.find((candidate) => candidate.ulid === activeUlid.data);
  if (active === undefined) {
    return ok({ consumers: [], issues: [] });
  }

  const consumers: DependencyConsumer[] = [];
  const issues: ConsumerIssue[] = [];
  for (const member of active.members) {
    const loaded = await manifest.load(member.repoPath);
    if (!loaded.ok) {
      issues.push({ service: member.service, repoPath: member.repoPath, message: loaded.error.message });
      continue;
    }
    const raw = loaded.data.modules?.[moduleId];
    if (raw === undefined) {
      continue;
    }
    const config = parseConfig(raw);
    if (!config.ok) {
      issues.push({ service: member.service, repoPath: member.repoPath, message: config.error.message });
      continue;
    }
    consumers.push({ service: member.service, repoPath: member.repoPath, branch: member.branch, ...config.data });
  }
  return ok({ consumers, issues });
}
