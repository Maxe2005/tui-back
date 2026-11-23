// adapters/driving/cli/subcommands: the production subcommand registry (AD-2). It assembles the
// per-family factories of ./commands in a fixed order, then appends `install` and `completion`
// (which close over the final list). assertUniqueSubcommandNames keeps a later entry from
// silently shadowing an earlier one.
import { err, ok } from '../../../core/result.js';
import type { Subcommand } from './dispatch/dispatch.js';
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
