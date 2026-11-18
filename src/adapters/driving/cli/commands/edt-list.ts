// cli/commands/edt-list: `edt list` — every registered EDT, with a `kind` marking the
// preconfigured "Shared branches" system EDT (`system-shared`, present only while
// `edts.sharedBranchesEdtEnabled` is on) apart from ordinary EDTs (`user`).
import { err, ok, type Result } from '../../../../core/result.js';
import type { EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import { isSystemEdt } from '../../../../core/edt/shared-edt.js';

export const EDT_LIST_USAGE = 'tui-back edt list';

export interface EdtListRow {
  ulid: string;
  topic: string;
  kind: 'user' | 'system-shared';
  status: string;
  members: Array<{ service: string; repoPath: string; branch: string }>;
}

export async function runEdtList(deps: { edtRegistry: EdtRegistryPort }, args: string[]): Promise<Result<{ edts: EdtListRow[] }>> {
  if (args.length !== 0) {
    return err('invalid-argument', `Usage: ${EDT_LIST_USAGE}`);
  }
  const listed = await deps.edtRegistry.list();
  if (!listed.ok) {
    return listed;
  }
  return ok({
    edts: listed.data.map((entry) => ({
      ulid: entry.ulid,
      topic: entry.topic,
      kind: isSystemEdt(entry) ? 'system-shared' : 'user',
      status: entry.status,
      members: entry.members.map((member) => ({ service: member.service, repoPath: member.repoPath, branch: member.branch })),
    })),
  });
}
