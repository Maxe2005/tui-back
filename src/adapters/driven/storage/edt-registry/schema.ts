// adapters/driven/storage/edt-registry/schema: the zod schema for edts.yaml — a strict { edts: [...] }
// map (not a bare list) so future fields don't need a format migration. Each entry carries a
// `topic` and per-member `members: [{ service, repoPath, branch }]`.
import { z } from 'zod';

export const edtMemberSchema = z
  .object({
    service: z.string().min(1),
    repoPath: z.string().min(1),
    branch: z.string().min(1),
  })
  .strict();

export const favoriteRouteSchema = z
  .object({
    repoPath: z.string().min(1),
    method: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

export const edtRegistryEntrySchema = z
  .object({
    ulid: z.string().min(1),
    topic: z.string().min(1),
    createdAt: z.string().min(1),
    status: z.enum(['active', 'inactive', 'interrupted']),
    members: z.array(edtMemberSchema),
    favoriteRoutes: z.array(favoriteRouteSchema).optional(),
  })
  .strict();

export const edtRegistrySchema = z
  .object({
    edts: z.array(edtRegistryEntrySchema),
  })
  .strict();
