// Per-million-token USD pricing snapshot for the models we use.
// Source: Anthropic public pricing as referenced in plan T22b.
// Update when Anthropic changes prices or we add models.

export type ModelPricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
};

export type ClaudeUsageInput = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function priceClaudeUsage(model: string, usage: ClaudeUsageInput): number {
  const p = MODEL_PRICING[model];
  if (!p) {
    console.warn(`[anthropic-pricing] unknown model "${model}" — returning 0 cost`);
    return 0;
  }
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cost =
    (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output +
    (cacheRead / 1_000_000) * p.cacheRead +
    (cacheWrite / 1_000_000) * p.cacheWrite;
  return cost;
}
