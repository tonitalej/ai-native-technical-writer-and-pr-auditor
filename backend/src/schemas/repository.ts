import { z } from 'zod';

export const connectRepositorySchema = z.strictObject({
  repository: z.string().trim().min(1).max(500),
  token: z.string().min(1).max(2000),
});
