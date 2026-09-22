// adapters/driven/modules/route-explorer/nestjs-openapi: the `nestjs-openapi`
// RouteScannerPort implementation (AD-5) — this backend's only scanner. Turns an OpenAPI
// 3.x document (JSON or YAML, from a manifest-configured file path / live URL, else a
// conventional spec file under the repo root) into the minimal purpose-built `Route[]`
// the Routes zone and `list-routes` render — never a generic Swagger schema browser.
//
// Manifest config shape (all optional, first defined string wins): `openapi` (a relative
// file path or an http(s) URL), `openapiPath`/`specPath` (file path), `openapiUrl`/`specUrl`
// (URL). With no config, the conventional candidates `openapi.json`, `openapi.yaml`,
// `openapi.yml`, `swagger.json`, `swagger.yaml`, `swagger.yml` are tried in order under
// the repo root. Anything unreadable/unparsable/not-an-OpenAPI-document is a named
// `route-scan-failed` with `details.reason` — never a throw, never an empty list. A
// document that parses but declares zero paths is the genuinely-empty `ok([])` case.
// Route identity is `method + path` (uppercase method); `summary` falls back to the
// operation's `description` when `summary` is absent.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { err, ok, type Result } from '../../../../core/result.js';
import type { Route, RouteScannerPort } from '../../../../core/ports/route-scanner.js';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

const DEFAULT_SPEC_CANDIDATES = [
  'openapi.json',
  'openapi.yaml',
  'openapi.yml',
  'swagger.json',
  'swagger.yaml',
  'swagger.yml',
] as const;

const URL_PATTERN = /^https?:\/\//i;

export interface NestjsOpenApiScannerOptions {
  readSpecFile?: (path: string) => Promise<string>;
  fetchSpec?: (url: string) => Promise<string>;
}

async function fetchSpecUrl(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`GET ${url} answered HTTP ${response.status}`);
  }
  return response.text();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function parseSpecDocument(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return parseYaml(text);
  }
}

function extractRoutes(document: unknown): Route[] {
  if (!isRecord(document)) {
    throw new Error('spec is not an OpenAPI object');
  }
  const paths = document['paths'];
  if (paths === undefined) {
    return [];
  }
  if (!isRecord(paths)) {
    throw new Error('spec.paths is not an object');
  }
  const routes: Route[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) {
      throw new Error(`spec.paths["${path}"] is not an object`);
    }
    for (const key of Object.keys(item)) {
      const lowered = key.toLowerCase();
      if (!HTTP_METHODS.includes(lowered as (typeof HTTP_METHODS)[number])) {
        continue;
      }
      if (key !== lowered) {
        throw new Error(`spec.paths["${path}"] has a non-lowercase method key "${key}"`);
      }
      const operation = item[key];
      if (!isRecord(operation)) {
        throw new Error(`spec.paths["${path}"].${key} is not an object`);
      }
      const summary = stringField(operation['summary']) ?? stringField(operation['description']);
      routes.push(
        summary === undefined ? { method: lowered.toUpperCase(), path } : { method: lowered.toUpperCase(), path, summary },
      );
    }
  }
  return routes;
}

function configuredSource(config: Record<string, unknown>): string | undefined {
  for (const key of ['openapi', 'openapiPath', 'specPath', 'openapiUrl', 'specUrl']) {
    const value = config[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

export function createNestjsOpenApiScanner(options: NestjsOpenApiScannerOptions = {}): RouteScannerPort {
  const readSpecFile = options.readSpecFile ?? ((path: string) => readFile(path, 'utf8'));
  const fetchSpec = options.fetchSpec ?? fetchSpecUrl;

  return {
    async scan(repoPath: string, config: Record<string, unknown>): Promise<Result<Route[]>> {
      try {
        const configured = configuredSource(config ?? {});
        if (configured !== undefined) {
          const text = URL_PATTERN.test(configured)
            ? await fetchSpec(configured)
            : await readSpecFile(resolve(repoPath, configured));
          return ok(extractRoutes(parseSpecDocument(text)));
        }
        let lastReason = `no OpenAPI spec found (tried ${DEFAULT_SPEC_CANDIDATES.join(', ')})`;
        for (const candidate of DEFAULT_SPEC_CANDIDATES) {
          try {
            const text = await readSpecFile(join(repoPath, candidate));
            return ok(extractRoutes(parseSpecDocument(text)));
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT') {
              // A candidate file exists but cannot be read or parsed — that is a scan
              // failure, not a cue to keep hunting further candidates.
              throw error;
            }
            lastReason = `no OpenAPI spec found (tried ${DEFAULT_SPEC_CANDIDATES.join(', ')})`;
          }
        }
        return err('route-scan-failed', `Route scan failed for ${repoPath}: ${lastReason}`, {
          reason: lastReason,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return err('route-scan-failed', `Route scan failed for ${repoPath}: ${reason}`, { reason });
      }
    },
  };
}
