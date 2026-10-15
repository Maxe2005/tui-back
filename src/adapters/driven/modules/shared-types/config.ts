// adapters/driven/modules/shared-types/config: the manifest parameter schemas of the
// `shared-types-source` and `shared-types-consumer` modules (AD-18). Every parameter is
// optional with a default; unknown parameters are rejected (strict); blanks are rejected.
import { z } from 'zod';

export const DEFAULT_PACKAGE_NAME = '@ianord/shared-types';
export const DEFAULT_REGISTRY = 'https://npm.ianord.fr';

const nonBlank = z.string().trim().min(1);

export const sharedTypesSourceConfigSchema = z
  .object({
    publishCommand: nonBlank.default('npm run v'),
    packageName: nonBlank.default(DEFAULT_PACKAGE_NAME),
    registry: nonBlank.default(DEFAULT_REGISTRY),
  })
  .strict();

export const sharedTypesConsumerConfigSchema = z
  .object({
    dependency: nonBlank.default(DEFAULT_PACKAGE_NAME),
    packageJsonPath: nonBlank.default('package.json'),
  })
  .strict();

export type SharedTypesSourceConfig = z.infer<typeof sharedTypesSourceConfigSchema>;
export type SharedTypesConsumerConfig = z.infer<typeof sharedTypesConsumerConfigSchema>;
