import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InstallerPort, NpmOutcome } from '../../driving/cli/install.js';
import { runProcess } from '../process.js';

// adapters/driven/installer: real InstallerPort: global npm install/uninstall through a spawned
// `npm` (EACCES detected from its stderr) plus the small file reads/writes the installer needs.

const PACKAGE_JSON = fileURLToPath(new URL('../../../../package.json', import.meta.url));

export function createInstallerPort(): InstallerPort {
  return {
    async repositoryUrl() {
      try {
        const pkg = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as { repository?: string | { url?: string } };
        const repository = pkg.repository;
        if (typeof repository === 'string') {
          return repository;
        }
        return typeof repository?.url === 'string' ? repository.url : null;
      } catch {
        return null;
      }
    },
    async npmGlobal(action, target): Promise<NpmOutcome> {
      const result = await runProcess('npm', [action, '-g', target]);
      if (result.error !== undefined) {
        const code = (result.error as NodeJS.ErrnoException).code;
        return code === 'ENOENT'
          ? { ok: false, kind: 'npm-not-found', message: result.error.message }
          : { ok: false, kind: 'failed', message: result.error.message };
      }
      if (result.status === 0) {
        return { ok: true };
      }
      const output = `${result.stderr}\n${result.stdout}`;
      if (/EACCES|EPERM/.test(output)) {
        return { ok: false, kind: 'permission-denied', message: output.trim() };
      }
      const tail = output.trim().split('\n').slice(-5).join('\n');
      return { ok: false, kind: 'failed', message: tail === '' ? `npm exited with status ${String(result.status)}` : tail };
    },
    async readFile(path) {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    async writeFile(path, content) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    },
    async removeFile(path) {
      try {
        await rm(path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return false;
        }
        throw error;
      }
    },
  };
}
