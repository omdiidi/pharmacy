// Output schemas for the two-stage Customer Success agent.

import { z } from 'zod';

export const TriageOutputSchema = z.object({
  classification: z.enum(['shipping', 'refund', 'general', 'medical_question', 'spam']),
  // Haiku occasionally omits reasoning/confidence; default rather than fail.
  reasoning: z.string().optional().default(''),
  confidence: z.number().min(0).max(1).optional().default(0.7),
});
export type TriageOutput = z.infer<typeof TriageOutputSchema>;

export const DraftOutputSchema = z.object({
  draft: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1).optional().default(0.7),
  reasoning: z.string().optional().default(''),
});
export type DraftOutput = z.infer<typeof DraftOutputSchema>;
