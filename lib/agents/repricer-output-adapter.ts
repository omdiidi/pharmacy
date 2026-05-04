// Maps the Repricer's Decision enum onto a kernel-shaped briefing_type +
// proposed_actions tuple. Mirrors the portfolio-manager-output-adapter pattern.
//
// Decisions:
//   match_bb / drop  → reprice_down briefing, primary "Drop to $X.XX" reprice action
//   raise            → reprice_up briefing, primary "Raise to $X.XX" reprice action
//   hold             → reprice_down briefing (closest enum), dismiss-only ("Acknowledge")
//   pause            → suspend briefing, primary pause_listing + dismiss "Skip"

import type { Json } from '@/lib/supabase/types';

export type RepricerDecision = 'match_bb' | 'hold' | 'raise' | 'drop' | 'pause';

export type RepricerOutput = {
  listing_id: string;
  decision: RepricerDecision;
  current_price: number | null;
  proposed_price: number | null;
  rationale: string;
  confidence: number;
};

export type AdapterResult = {
  briefing_type: 'reprice_up' | 'reprice_down' | 'suspend';
  proposed_actions: Json;
  urgency: number;
  summary: string;
};

function fmtUsd(n: number | null): string {
  return n === null ? '—' : `$${n.toFixed(2)}`;
}

export function mapDecisionToBriefing(parsed: RepricerOutput): AdapterResult {
  const { decision, listing_id, current_price, proposed_price, rationale } = parsed;

  if (decision === 'pause') {
    return {
      briefing_type: 'suspend',
      urgency: 4,
      summary: `Suspend listing ${listing_id}: margin would drop below floor`,
      proposed_actions: [
        {
          kind: 'pause_listing',
          label: 'Suspend listing',
          variant: 'primary',
          params: {
            listing_id,
            triggered_by: 'repricer_suspend',
            reasoning: rationale,
          },
        },
        { kind: 'dismiss_briefing', label: 'Skip', variant: 'secondary', params: {} },
      ] as Json,
    };
  }

  if (decision === 'hold') {
    return {
      briefing_type: 'reprice_down',
      urgency: 1,
      summary: `Hold ${listing_id}: ${rationale.slice(0, 120)}`,
      proposed_actions: [
        {
          kind: 'dismiss_briefing',
          label: 'Acknowledge',
          variant: 'secondary',
          params: {},
        },
      ] as Json,
    };
  }

  // raise / match_bb / drop
  const briefing_type: 'reprice_up' | 'reprice_down' = decision === 'raise' ? 'reprice_up' : 'reprice_down';
  const verb = decision === 'raise' ? 'Raise' : 'Drop';
  const label = `${verb} to ${fmtUsd(proposed_price)}`;
  const summary = `${verb} ${listing_id} from ${fmtUsd(current_price)} to ${fmtUsd(proposed_price)}`;

  return {
    briefing_type,
    urgency: 3,
    summary,
    proposed_actions: [
      {
        kind: 'reprice',
        label,
        variant: 'primary',
        params: {
          listing_id,
          decision,
          from_price: current_price,
          to_price: proposed_price,
          reasoning: rationale,
          trigger: 'manual',
        },
      },
      { kind: 'dismiss_briefing', label: 'Skip', variant: 'secondary', params: {} },
    ] as Json,
  };
}
