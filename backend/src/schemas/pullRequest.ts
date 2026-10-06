import { z } from 'zod';

import { paginationQuerySchema } from './common.js';

export const pullRequestListQuerySchema = paginationQuerySchema.extend({
  state: z.enum(['open', 'draft', 'closed', 'merged']).optional(),
});
