// adapters/driving/cli/subcommands: the production subcommand registry (AD-2). Each entry is a
// thin wrapper around one core use-case that also validates argument cardinality, so a typo'd
// or excess argument is an explicit invalid-argument instead of being ignored.
// assertUniqueSubcommandNames keeps a later entry from silently shadowing an earlier one.
import { err, ok } from '../../../core/result.js';
import type { Subcommand } from './dispatch.js';
import { generateBashCompletion } from './completion-spec.js';
import { createInstallSubcommand } from './install.js';
import type { SubcommandDeps } from './commands/deps.js';
import { dashboardSubcommand, edtsSubcommand, listReposSubcommand, pingSubcommand, registerSubcommand, scanSubcommand } from './commands/basic.js';
import { edtSubcommand } from './commands/edt.js';
import { updateSubcommand } from './commands/update.js';
import { realignSubcommand } from './commands/realign.js';
import { healSubcommand } from './commands/heal.js';
import { registrySubcommand } from './commands/registry.js';
import { fireRequestSubcommand, listRoutesSubcommand, requestDeleteSubcommand, requestFireSubcommand, requestListSubcommand } from './commands/request.js';

const COMPLETION_USAGE = 'tui-back completion bash';

export function buildSubcommands(deps: SubcommandDeps): Subcommand[] {
  const subcommands: Subcommand[] = [
    registerSubcommand(deps),
    listReposSubcommand(deps),
    scanSubcommand(deps),
    pingSubcommand(deps),
    edtsSubcommand(deps),
    dashboardSubcommand(deps),
    edtSubcommand(deps),
    updateSubcommand(deps),
    realignSubcommand(deps),
    healSubcommand(deps),
    registrySubcommand(deps),
    listRoutesSubcommand(deps),
    fireRequestSubcommand(deps),
    requestListSubcommand(deps),
    requestFireSubcommand(deps),
    requestDeleteSubcommand(deps),
  ];
  subcommands.push(createInstallSubcommand({ ...deps.install, commands: () => subcommands }));
  // Registered last and closing over the final list, so the generated script includes itself.
  subcommands.push({
    name: 'completion',
    usage: COMPLETION_USAGE,
    run: async (args) => {
      if (args.length !== 1 || args[0] !== 'bash') {
        return err('invalid-argument', `Usage: ${COMPLETION_USAGE}`);
      }
      return ok({ script: generateBashCompletion({ commands: subcommands }) });
    },
    humanText: (data) => (data as { script: string }).script,
  });
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
