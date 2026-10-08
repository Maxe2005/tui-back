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
  code: string;
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

export interface SourceConfig {
  publishCommand: string;
  packageName: string;
}

export interface SourceEntry extends SourceConfig {
  service: string;
  repoPath: string;
  branch: string;
}

export interface SourceIssue {
  service: string;
  repoPath: string;
  code: string;
  message: string;
}

export interface ListSourcesData {
  sources: SourceEntry[];
  issues: SourceIssue[];
}

export type SourceConfigParser = (raw: Record<string, unknown>) => Result<SourceConfig>;

export interface ListSourcesParams {
  edtRegistry: EdtRegistryPort;
  manifest: ManifestPort;
  state: StatePort;
  moduleId: string;
  parseConfig: SourceConfigParser;
}

export async function listConsumers(params: ListConsumersParams): Promise<Result<ListConsumersData>> {
  const listed = await listModuleEntries({
    edtRegistry: params.edtRegistry,
    manifest: params.manifest,
    state: params.state,
    moduleId: params.moduleId,
    parseConfig: params.parseConfig,
  });
  if (!listed.ok) {
    return listed;
  }
  return ok({
    consumers: listed.data.entries.map((entry) => ({
      service: entry.service,
      repoPath: entry.repoPath,
      branch: entry.branch,
      dependency: (entry.config as DependencyConsumerConfig).dependency,
      packageJsonPath: (entry.config as DependencyConsumerConfig).packageJsonPath,
    })),
    issues: listed.data.issues,
  });
}

export async function listSources(params: ListSourcesParams): Promise<Result<ListSourcesData>> {
  const listed = await listModuleEntries({
    edtRegistry: params.edtRegistry,
    manifest: params.manifest,
    state: params.state,
    moduleId: params.moduleId,
    parseConfig: params.parseConfig,
  });
  if (!listed.ok) {
    return listed;
  }
  return ok({
    sources: listed.data.entries.map((entry) => ({
      service: entry.service,
      repoPath: entry.repoPath,
      branch: entry.branch,
      publishCommand: (entry.config as SourceConfig).publishCommand,
      packageName: (entry.config as SourceConfig).packageName,
    })),
    issues: listed.data.issues,
  });
}

interface ModuleEntry<T> {
  service: string;
  repoPath: string;
  branch: string;
  config: T;
}

async function listModuleEntries<T>(params: {
  edtRegistry: EdtRegistryPort;
  manifest: ManifestPort;
  state: StatePort;
  moduleId: string;
  parseConfig: (raw: Record<string, unknown>) => Result<T>;
}): Promise<Result<{ entries: ModuleEntry<T>[]; issues: ConsumerIssue[] }>> {
  const { edtRegistry, manifest, state, moduleId, parseConfig } = params;
  const activeUlid = await state.readActiveEdt();
  if (!activeUlid.ok) {
    return activeUlid;
  }
  if (activeUlid.data === null) {
    return ok({ entries: [], issues: [] });
  }
  const edts = await edtRegistry.list();
  if (!edts.ok) {
    return edts;
  }
  const active = edts.data.find((candidate) => candidate.ulid === activeUlid.data);
  if (active === undefined) {
    return ok({ entries: [], issues: [] });
  }

  const entries: ModuleEntry<T>[] = [];
  const issues: ConsumerIssue[] = [];
  for (const member of active.members) {
    const loaded = await manifest.load(member.repoPath);
    if (!loaded.ok) {
      issues.push({ service: member.service, repoPath: member.repoPath, code: loaded.error.code, message: loaded.error.message });
      continue;
    }
    const raw = loaded.data.modules?.[moduleId];
    if (raw === undefined) {
      continue;
    }
    const config = parseConfig(raw);
    if (!config.ok) {
      issues.push({ service: member.service, repoPath: member.repoPath, code: config.error.code, message: config.error.message });
      continue;
    }
    entries.push({ service: member.service, repoPath: member.repoPath, branch: member.branch, config: config.data });
  }
  return ok({ entries, issues });
}
