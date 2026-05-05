// Maps a Research Analyst pick (LLM output) to the briefing fields we insert.
// Reused by lib/agents/research-analyst.ts; mirrors the Wave 1
// portfolio-manager-output-adapter pattern.

import type { Database } from '@/lib/supabase/types';

export type ResearchPick = {
  product_id: string | null;
  candidate_name: string;
  ndc: string | null;
  asin: string | null;
  score: number;
  confidence: number;
  urgency: number;
  rationale: string;
  signals: string[];
};

type BriefingType = Database['public']['Enums']['briefing_type'];

export function pickToBriefingType(pick: ResearchPick): BriefingType {
  // 'rx_shortage_adjacency' covers any FDA-shortage-driven pick (incl. direct
  // OTC shortages) per locked decision 27.
  if (pick.signals.some((s) => s.startsWith('fda_shortage'))) return 'rx_shortage_adjacency';
  if (pick.signals.some((s) => s.startsWith('fda_recall'))) return 'fda_recall_triggered';
  return 'new_opportunity';
}

export type ProposedAction = {
  kind: string;
  variant?: 'primary' | 'secondary';
  label: string;
  params: Record<string, unknown>;
};

export function pickToProposedActions(pick: ResearchPick): ProposedAction[] {
  if (pick.product_id) {
    return [
      {
        kind: 'add_to_watchlist',
        variant: 'primary',
        label: 'Add to watchlist',
        params: {
          product_ids: [pick.product_id],
          reason: pick.rationale.slice(0, 500),
        },
      },
      { kind: 'dismiss_briefing', label: 'Skip', params: {} },
    ];
  }
  // No internal product row yet — Acknowledge-only path.
  return [{ kind: 'dismiss_briefing', label: 'Acknowledge', params: {} }];
}
