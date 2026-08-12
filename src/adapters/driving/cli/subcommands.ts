// adapters/driving/cli/subcommands: the production subcommand registry (AD-2). Each entry
// is a thin wrapper around exactly one core use-case; the first story registering more than
// one subcommand, so it also owns the duplicate-name guard (assertUniqueSubcommandNames)
// that would otherwise let a future registry silently shadow an earlier subcommand.
import { ping } from '../../../core/ping.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import { registerRepo } from '../../../core/scripts/register.js';
import { listRepos } from '../../../core/scripts/list-repos.js';
import { scanRepos } from '../../../core/scripts/scan.js';
import type { Subcommand } from './dispatch.js';

export function buildSubcommands(deps: { registry: RegistryPort; manifest: ManifestPort }): Subcommand[] {
  const subcommands: Subcommand[] = [
    { name: 'register', run: (args) => registerRepo(deps.registry, args[0]) },
    { name: 'list-repos', run: () => listRepos(deps.registry, deps.manifest) },
    { name: 'scan', run: (args) => scanRepos(deps.registry, args[0]) },
    { name: 'ping', run: () => ping() },
  ];
  assertUniqueSubcommandNames(subcommands);
  return subcommands;
}

export function assertUniqueSubcommandNames(subcommands: Subcommand[]): void {
  const seen = new Set<string>();
  for (const subcommand of subcommands) {
    if (seen.has(subcommand.name)) {
      throw new Error(`Duplicate subcommand name: ${subcommand.name}`);
    }
    seen.add(subcommand.name);
  }
}
