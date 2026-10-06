import type { AiClient, AiCompletionResult } from '../../src/services/ai/aiService.js';
import type { ChatMessage } from '../../src/services/ai/prompts/auditPrompt.js';
import type { TokenUsage } from '../../src/types/domain.js';

export const VALID_AUDIT_OUTPUT = {
  summary: 'The pull request updates the greeting in the application module.',
  documentation: '## What changed\n\n`src/app.ts` now returns a greeting.',
  security_flags: [
    {
      severity: 'high',
      confidence: 'confirmed',
      category: 'hardcoded-secret',
      title: 'Hardcoded GitHub token',
      description: 'A GitHub personal access token is assigned in src/app.ts.',
      file: 'src/app.ts',
      line: 2,
      recommendation: 'Remove the token and load it from a secret store.',
    },
  ],
};

export class FakeAi implements AiClient {
  content: string | null = JSON.stringify(VALID_AUDIT_OUTPUT);
  refusal: string | null = null;
  finishReason: string | null = 'stop';
  model: string | null = 'gpt-test-snapshot';
  usage: TokenUsage | null = { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 };
  error: Error | null = null;
  messages: ChatMessage[][] = [];

  async auditCompletion(input: { messages: ChatMessage[] }): Promise<AiCompletionResult> {
    this.messages.push(input.messages);
    if (this.error) {
      throw this.error;
    }
    return {
      content: this.content,
      refusal: this.refusal,
      finishReason: this.finishReason,
      model: this.model,
      usage: this.usage,
    };
  }
}
