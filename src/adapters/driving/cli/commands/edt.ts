// cli/commands/edt: the `edt` verb-dispatch subcommand (create / switch / modify / delete).
import { err } from '../../../../core/result.js';
import { Subcommand } from '../dispatch.js';
import { SubcommandDeps } from './deps.js';
import { EDT_CREATE_USAGE, runEdtCreate } from './edt-create.js';
import { EDT_SWITCH_USAGE, runEdtSwitch } from './edt-switch.js';
import { EDT_MODIFY_USAGE, runEdtModify } from './edt-modify.js';
import { EDT_DELETE_USAGE, runEdtDelete } from './edt-delete.js';

const EDT_USAGE = `${EDT_CREATE_USAGE}\n${EDT_SWITCH_USAGE}\n${EDT_MODIFY_USAGE}\n${EDT_DELETE_USAGE}`;

export function edtSubcommand(deps: SubcommandDeps): Subcommand {
  return {
    name: 'edt',
    usage: EDT_USAGE,
    run: async (args) => {
      if (args[0] === 'create') {
        return runEdtCreate(deps, args.slice(1));
      }
      if (args[0] === 'switch') {
        return runEdtSwitch(deps, args.slice(1));
      }
      if (args[0] === 'modify') {
        return runEdtModify(deps, args.slice(1));
      }
      if (args[0] === 'delete') {
        return runEdtDelete(deps, args.slice(1));
      }
      const label = args[0] === undefined ? '(none)' : `"${args[0]}"`;
      return err('invalid-argument', `Unknown edt action: ${label}. Usage:\n${EDT_USAGE}`);
    },
  };
}
