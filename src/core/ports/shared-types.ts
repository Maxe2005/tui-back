// core/ports/shared-types: the SharedTypesPort a repo's `shared-types-*` modules implement
// (AD-5). Core only sees this contract: read the declared version of a dependency, rewrite
// only that dependency's version line, and verify a version exists on the package registry.
// Every parameter is explicit (the caller owns manifest defaults and repo-path joining).
// Error codes: `package-json-unreadable` (I/O or parse failure), `dependency-not-found`
// (absent from dependencies and devDependencies), `registry-unreachable` (the registry could
// not be queried — distinct from "version not found", which is `ok(false)`).
import type { Result } from '../result.js';

export interface SharedTypesPort {
  // The declared version string, verbatim (it may be a range such as `^0.1.3`).
  readVersion(packageJsonPath: string, dependency: string): Promise<Result<string>>;
  // The source repo's own `version` field, trimmed (never a range).
  readOwnVersion(packageJsonPath: string): Promise<Result<string>>;
  // Targeted text edit of the dependency's version line; every other byte is preserved.
  writeVersionLine(packageJsonPath: string, dependency: string, version: string): Promise<Result<void>>;
  // true when the registry has the version, false when it reports none; never throws.
  verifyPublished(packageName: string, version: string): Promise<Result<boolean>>;
}
