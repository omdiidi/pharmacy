type ModelPricing = {
  inputPerM: number;
  outputPerM: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'anthropic/claude-sonnet-4.6': { inputPerM: 3.0, outputPerM: 15.0 },
  // OpenRouter sometimes echoes upstream model id (date-stamped) rather than the slug.
  'anthropic/claude-4.6-sonnet-20260217': { inputPerM: 3.0, outputPerM: 15.0 },
  // Wave 2: Haiku 4.5 used by Customer Success Triage stage (fast classify).
  'anthropic/claude-haiku-4.5': { inputPerM: 1.0, outputPerM: 5.0 },
  // OpenRouter date-stamped echo for Haiku 4.5 (verified via probe 2026-05-04).
  'anthropic/claude-4.5-haiku-20251001': { inputPerM: 1.0, outputPerM: 5.0 },
  'x-ai/grok-4.3': { inputPerM: 0.5, outputPerM: 2.0 },
  'inception/mercury-2': { inputPerM: 0.25, outputPerM: 1.0 },
};

export type LLMUsage = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
};

export function priceLLMUsage(model: string, usage: LLMUsage | null | undefined): number {
  if (!usage) return 0;
  const p = MODEL_PRICING[model];
  if (!p) {
    console.warn(`[pricing] unknown model: ${model} — recorded as $0`);
    return 0;
  }
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  return (inputTokens * p.inputPerM + outputTokens * p.outputPerM) / 1_000_000;
}
