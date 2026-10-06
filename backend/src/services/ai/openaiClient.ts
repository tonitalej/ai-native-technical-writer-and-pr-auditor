import OpenAI from 'openai';

import type { AppConfig } from '../../config/env.js';
import type { TokenUsage } from '../../types/domain.js';
import { AUDIT_OUTPUT_JSON_SCHEMA } from './schema.js';
import type { AiClient } from './aiService.js';

export function createOpenAiClient(config: AppConfig): AiClient {
  const client = new OpenAI({
    apiKey: config.openaiApiKey,
    timeout: config.openaiTimeoutMs,
    maxRetries: 2,
  });

  return {
    async auditCompletion({ messages, signal }) {
      const completion = await client.chat.completions.create(
        {
          model: config.openaiModel,
          messages,
          max_completion_tokens: config.openaiMaxOutputTokens,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'pull_request_audit',
              strict: true,
              schema: AUDIT_OUTPUT_JSON_SCHEMA,
            },
          },
        },
        signal ? { signal } : {},
      );

      const choice = completion.choices[0];
      return {
        content: choice?.message.content ?? null,
        refusal: choice?.message.refusal ?? null,
        finishReason: choice?.finish_reason ?? null,
        model: completion.model || null,
        usage: readUsage(completion.usage),
      };
    },
  };
}

function readUsage(usage: OpenAI.CompletionUsage | undefined): TokenUsage | null {
  if (!usage) {
    return null;
  }
  const prompt = usage.prompt_tokens;
  const completion = usage.completion_tokens;
  const total = usage.total_tokens;
  if (
    typeof prompt !== 'number' ||
    typeof completion !== 'number' ||
    typeof total !== 'number'
  ) {
    return null;
  }
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}
