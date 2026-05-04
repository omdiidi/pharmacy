// Maps the Portfolio Manager's free-form `strategic_moves[].proposed_action`
// onto the three concrete kernel executors (add_to_watchlist, pause_brand,
// flag_anomaly) via a Zod discriminated union. Moves that don't map cleanly
// surface as informational entries in data_snapshot.unmapped_moves[].

import { z } from 'zod';

const AddToWatchlistAction = z.object({
  kind: z.literal('add_to_watchlist'),
  params: z.object({
    product_ids: z.array(z.string().uuid()).min(1).max(20),
    reason: z.string(),
  }),
});

const PauseBrandAction = z.object({
  kind: z.literal('pause_brand'),
  params: z.object({
    brand: z.string().min(1),
    reason: z.string(),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
});

const FlagAnomalyAction = z.object({
  kind: z.literal('flag_anomaly'),
  params: z.object({
    anomaly_type: z.string(),
    related_entity_type: z.string(),
    related_ids: z.array(z.string().uuid()).min(1),
    severity: z.enum(['info', 'warn', 'critical']),
    reason: z.string(),
  }),
});

export const ProposedActionSchema = z.discriminatedUnion('kind', [
  AddToWatchlistAction,
  PauseBrandAction,
  FlagAnomalyAction,
]);
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

const StrategicMoveSchema = z.object({
  move: z.string(),
  rationale: z.string(),
  target_agent: z.string(),
  success_metric: z.string(),
  proposed_action: ProposedActionSchema.nullable(),
});

export const PortfolioManagerOutputSchema = z.object({
  week_of: z.string(),
  top_sellers: z
    .array(z.object({ product_id: z.string().uuid(), ttm_net: z.number() }))
    .optional(),
  dead_inventory: z
    .array(z.object({ product_id: z.string().uuid(), days_since_sale: z.number() }))
    .optional(),
  strategic_moves: z.array(StrategicMoveSchema).max(3),
  reasoning: z.string(),
});

export type PortfolioManagerOutput = z.infer<typeof PortfolioManagerOutputSchema>;
