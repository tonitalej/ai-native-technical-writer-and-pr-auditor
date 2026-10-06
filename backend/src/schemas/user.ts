import { z } from 'zod';

export const patchMeSchema = z.strictObject({
  display_name: z.union([z.string().trim().min(1).max(100), z.null()]),
});
