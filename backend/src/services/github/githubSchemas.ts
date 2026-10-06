import { z } from 'zod';

export const githubUserSchema = z.object({
  id: z.number(),
  login: z.string().min(1),
});

export const githubRepositorySchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  private: z.boolean(),
  default_branch: z.string().min(1),
  html_url: z.string().url(),
  owner: z.object({
    login: z.string().min(1),
  }),
});

const githubPullCoreSchema = z.object({
  id: z.number(),
  number: z.number().int().positive(),
  title: z.string(),
  html_url: z.string().nullable().optional(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().optional().default(false),
  user: z.object({ login: z.string().min(1) }).nullable(),
  head: z.object({
    ref: z.string(),
    sha: z.string(),
  }),
  base: z.object({
    ref: z.string(),
  }),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  merged_at: z.string().nullable().optional(),
});

export const githubPullSchema = githubPullCoreSchema;
export const githubPullListSchema = z.array(githubPullSchema);

export const githubPullDetailSchema = githubPullCoreSchema.extend({
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changed_files: z.number().int().nonnegative(),
});

export const githubPullFileSchema = z.object({
  filename: z.string().min(1),
  status: z.string(),
  previous_filename: z.string().optional(),
  patch: z.string().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  changes: z.number().optional(),
  binary: z.boolean().optional(),
});

export const githubPullFileListSchema = z.array(githubPullFileSchema);

export type GithubPull = z.infer<typeof githubPullSchema>;
export type GithubPullDetail = z.infer<typeof githubPullDetailSchema>;
export type GithubPullFile = z.infer<typeof githubPullFileSchema>;
