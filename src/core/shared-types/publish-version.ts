// core/shared-types/publish-version: runs the source repo's configured publish command
// exactly once per attempt, then reads the source's own version and requires it to be
// present on the registry before reporting success. No step loop, no resume.
import { join } from 'node:path';
import type { GitPort } from '../ports/git.js';
import type { RestartPort } from '../ports/restart.js';
import type { SharedTypesPort } from '../ports/shared-types.js';
import { err, ok, type Result } from '../result.js';

export interface PublishParams {
  git: GitPort;
  restart: RestartPort;
  shared: SharedTypesPort;
  sourceRepoPath: string;
  publishCommand: string;
  packageName: string;
}

export interface PublishSuccess {
  version: string;
  output: string;
}

export async function runPublish(params: PublishParams): Promise<Result<PublishSuccess>> {
  const { git, restart, shared, sourceRepoPath, publishCommand, packageName } = params;
  if (publishCommand.trim() === '') {
    return err('invalid-publish-command', 'The publish command must not be empty.');
  }
  const branch = await git.currentBranch(sourceRepoPath);
  if (!branch.ok) {
    return branch;
  }
  const allowed = await git.assertAllowedBranch(sourceRepoPath, branch.data);
  if (!allowed.ok) {
    return allowed;
  }
  const ran = await restart.run(sourceRepoPath, publishCommand);
  if (!ran.ok) {
    return err('publish-failed', ran.error.message);
  }
  const owned = await shared.readOwnVersion(join(sourceRepoPath, 'package.json'));
  if (!owned.ok) {
    return owned;
  }
  const version = owned.data.trim();
  if (version === '') {
    return err('package-json-unreadable', `Cannot read ${join(sourceRepoPath, 'package.json')}: missing or blank "version" field`);
  }
  const verified = await shared.verifyPublished(packageName, version);
  if (!verified.ok) {
    return verified;
  }
  if (!verified.data) {
    return err('version-not-published', `${packageName}@${version} is not published on the registry.`);
  }
  return ok({ version, output: ran.data.output });
}
