import { EMPTY_TOKEN_USAGE, type TokenUsage } from '../../types/domain.js';
import { AppError } from '../../utils/errors.js';
import { auditFailure } from '../audits/auditErrors.js';
import type { ChatMessage } from './prompts/auditPrompt.js';
import { auditOutputSchema, type AuditModelOutput } from './schema.js';

export interface AiCompletionResult {
  content: string | null;
  refusal: string | null;
  finishReason: string | null;
  model: string | null;
  usage: TokenUsage | null;
}

export interface AiClient {
  auditCompletion(input: { messages: ChatMessage[]; signal?: AbortSignal }): Promise<AiCompletionResult>;
}

export interface CompletedModelCall {
  output: AuditModelOutput;
  model: string;
  usage: TokenUsage;
}

export async function completeAuditAnalysis(
  ai: AiClient,
  messages: ChatMessage[],
  fallbackModel: string,
  signal?: AbortSignal,
): Promise<CompletedModelCall> {
  let result: AiCompletionResult;
  try {
    result = await ai.auditCompletion({ messages, signal });
  } catch (error) {
    if (signal?.aborted || error instanceof AppError) {
      throw error;
    }
    throw auditFailure('AI_UNAVAILABLE', 502);
  }

  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : auditFailure('AI_UNAVAILABLE', 502);
  }
  if (result.refusal && result.refusal.trim().length > 0) {
    throw auditFailure('AI_REFUSED');
  }
  if (result.finishReason === 'length') {
    throw auditFailure('AI_OUTPUT_TRUNCATED');
  }
  if (!result.content || !result.content.trim()) {
    throw auditFailure('AI_INVALID_OUTPUT');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(result.content) as unknown;
  } catch {
    throw auditFailure('AI_INVALID_OUTPUT');
  }
  const parsed = auditOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw auditFailure('AI_INVALID_OUTPUT');
  }

  const model = result.model?.trim() ? result.model : fallbackModel;
  return {
    output: parsed.data,
    model,
    usage: normalizeUsage(result.usage),
  };
}

function normalizeUsage(usage: TokenUsage | null): TokenUsage {
  if (!usage) {
    return { ...EMPTY_TOKEN_USAGE };
  }
  const values = [usage.prompt_tokens, usage.completion_tokens, usage.total_tokens];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return { ...EMPTY_TOKEN_USAGE };
  }
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
}
