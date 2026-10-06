import { describe, expect, it } from 'vitest';

import { completeAuditAnalysis } from '../../src/services/ai/aiService.js';
import { FakeAi, VALID_AUDIT_OUTPUT } from '../fakes/fakeAi.js';

const messages = [{ role: 'system' as const, content: 'rules' }, { role: 'user' as const, content: 'diff' }];

describe('model outcomes', () => {
  it('stores usage from a valid response and rejects refusal, truncation, and bad JSON', async () => {
    const ai = new FakeAi();
    const ok = await completeAuditAnalysis(ai, messages, 'configured-model');
    expect(ok.model).toBe('gpt-test-snapshot');
    expect(ok.usage.total_tokens).toBe(33);
    expect(ok.output.summary).toBe(VALID_AUDIT_OUTPUT.summary);

    ai.model = null;
    ai.usage = null;
    const fallback = await completeAuditAnalysis(ai, messages, 'configured-model');
    expect(fallback.model).toBe('configured-model');
    expect(fallback.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });

    ai.refusal = 'no';
    await expect(completeAuditAnalysis(ai, messages, 'configured-model')).rejects.toMatchObject({ code: 'AI_REFUSED' });
    ai.refusal = null;
    ai.finishReason = 'length';
    await expect(completeAuditAnalysis(ai, messages, 'configured-model')).rejects.toMatchObject({
      code: 'AI_OUTPUT_TRUNCATED',
    });
    ai.finishReason = 'stop';
    ai.content = 'not-json';
    await expect(completeAuditAnalysis(ai, messages, 'configured-model')).rejects.toMatchObject({
      code: 'AI_INVALID_OUTPUT',
    });
    ai.content = JSON.stringify({ summary: '', documentation: 'x', security_flags: [] });
    await expect(completeAuditAnalysis(ai, messages, 'configured-model')).rejects.toMatchObject({
      code: 'AI_INVALID_OUTPUT',
    });
    ai.content = JSON.stringify(VALID_AUDIT_OUTPUT);
    ai.error = new Error('upstream down');
    await expect(completeAuditAnalysis(ai, messages, 'configured-model')).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
    });
  });
});
