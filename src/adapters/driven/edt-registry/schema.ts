// adapters/driven/edt-registry/schema: the zod schema for edts.yaml. Mirrors
// registry/schema.ts's conventions — a strict { edts: [...] } map (not a bare list) so
// future fields don't need a format migration.
import { z } from 'zod';

export const edtRegistryEntrySchema = z
  .object({
    ulid: z.string().min(1),
    branch: z.string().min(1),
    createdAt: z.string().min(1),
    status: z.string().min(1),
  })
  .strict();

export const edtRegistrySchema = z
  .object({
    edts: z.array(edtRegistryEntrySchema),
  })
  .strict();
