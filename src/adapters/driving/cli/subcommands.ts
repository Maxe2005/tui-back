// adapters/driving/cli/subcommands: the production subcommand registry (AD-2). Each entry
// is a thin wrapper around exactly one core use-case; the first story registering more than
// one subcommand, so it also owns the duplicate-name guard (assertUniqueSubcommandNames)
// that would otherwise let a future registry silently shadow an earlier subcommand.
// Wrappers also validate argument cardinality so a typo'd or excess argument is an explicit
// invalid-argument error instead of a silently ignored one.
import { err } from '../../../core/result.js';
import { ping } from '../../../core/ping.js';
import { createEdt } from '../../../core/edt/create.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { LockPort } from '../../../core/ports/lock.js';
import { registerRepo } from '../../../core/scripts/register.js';
import { resetRepo } from '../../../core/scripts/reset.js';
import { listRepos } from '../../../core/scripts/list-repos.js';
import { scanRepos } from '../../../core/scripts/scan.js';
import type { Subcommand } from './dispatch.js';

export function buildSubcommands(deps: {
  registry: RegistryPort;
  manifest: ManifestPort;
  lock: LockPort;
  registryResourceKey: string;
  edtsBaseDir: string;
  edtRegistry: EdtRegistryPort;
  edtRegistryResourceKey: string;
}): Subcommand[] {
  const subcommands: Subcommand[] = [
    {
      name: 'register',
      usage: 'tui-back register [--reset] <path>',
      run: async (args) => {
        if (args.length === 0) {
          return registerRepo(deps.registry, deps.lock, deps.registryResourceKey, undefined);
        }
        if (args[0] === '--reset') {
          if (args.length > 2) {
            return err('invalid-argument', 'Usage: tui-back register --reset <path>');
          }
          return resetRepo(deps.registry, deps.lock, deps.registryResourceKey, args[1]);
        }
        if (args.length > 1) {
          return err('invalid-argument', 'Usage: tui-back register <path>');
        }
        return registerRepo(deps.registry, deps.lock, deps.registryResourceKey, args[0]);
      },
    },
    {
      name: 'list-repos',
      usage: 'tui-back list-repos',
      run: async (args) =>
        args.length === 0
          ? listRepos(deps.registry, deps.manifest)
          : err('invalid-argument', 'Usage: tui-back list-repos'),
    },
    {
      name: 'scan',
      usage: 'tui-back scan <root>',
      run: async (args) => {
        if (args.length === 0) {
          return scanRepos(deps.registry, undefined);
        }
        if (args.length > 1) {
          return err('invalid-argument', 'Usage: tui-back scan <root>');
        }
        return scanRepos(deps.registry, args[0]);
      },
    },
    {
      name: 'ping',
      usage: 'tui-back ping',
      run: async (args) => (args.length === 0 ? ping() : err('invalid-argument', 'Usage: tui-back ping')),
    },
    {
      name: 'edt',
      usage: 'tui-back edt create',
      run: async (args) => {
        if (args[0] !== 'create') {
          const label = args[0] === undefined ? '(none)' : `"${args[0]}"`;
          return err('invalid-argument', `Unknown edt action: ${label}. Usage: tui-back edt create`);
        }
        if (args.length > 1) {
          return err('invalid-argument', 'Usage: tui-back edt create');
        }
        return createEdt({
          edtsBaseDir: deps.edtsBaseDir,
          manifest: deps.manifest,
          edtRegistry: deps.edtRegistry,
          lock: deps.lock,
          edtRegistryResourceKey: deps.edtRegistryResourceKey,
        });
      },
    },
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
