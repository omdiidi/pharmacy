import { Inbox as InboxIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

import { BriefingCard } from './briefing-card';

// `kind` is the executor taxonomy key (e.g. 'list_on_amazon', 'reprice', 'pause_listing').
// `variant` is the UI button hint. (Renamed from the old `kind: 'primary' | 'secondary'`
// in Phase 2 — the executor taxonomy needed the `kind` slot.)
export type ProposedAction = {
  label: string;
  kind?: string;
  variant?: 'primary' | 'secondary';
  params?: Record<string, unknown>;
};

export type InboxState = 'pending' | 'seen' | 'acted' | 'archived' | 'dismissed';

export type BriefingItem = {
  id: string;
  title: string;
  summary?: string | null;
  rationale?: string | null;
  urgency?: number | null;
  confidence?: number | null;
  briefing_type?: string | null;
  source_agent?: string | null;
  created_at?: string | null;
  proposed_actions?: ProposedAction[] | null;
  state?: InboxState;
  acted_at?: string | null;
  action_taken?: string | null;
  // Latest non-undo audit_log row for this inbox_item, if any.
  audit_log_id?: string | null;
  undo_window_expires_at?: string | null;
  undone_at?: string | null;
};

function dayBucket(iso: string | null | undefined): string {
  if (!iso) return 'Earlier';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function agentLabel(source: string | null | undefined): string {
  switch (source) {
    case 'bookkeeper':
      return 'Bookkeeper';
    case 'reflector':
      return 'Reflector';
    case 'portfolio_manager':
      return 'Portfolio Manager';
    case 'listing_agent':
      return 'Listing Agent';
    case 'repricer':
      return 'Repricer';
    case 'research_analyst':
      return 'Research Analyst';
    case 'account_health':
      return 'Account Health';
    case 'fulfillment_ops':
      return 'Fulfillment Ops';
    case 'customer_success':
      return 'Customer Success';
    default:
      return source ?? 'Unknown agent';
  }
}

export function Timeline({ items }: { items: BriefingItem[] }) {
  if (!items || items.length === 0) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="flex flex-col items-center text-center gap-3 py-12">
          <div className="rounded-full bg-secondary p-3 text-muted-foreground">
            <InboxIcon className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold">No briefings yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Agents will populate this when runtime is online. For now, head to Chat to talk to
            the Chief of Staff directly.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group by source_agent first (latest-briefing-in-section descending), then
  // by day-bucket inside each agent section.
  const byAgent = new Map<string, Map<string, BriefingItem[]>>();
  const agentLatest = new Map<string, number>();
  for (const item of items) {
    const a = item.source_agent ?? 'unknown';
    const d = dayBucket(item.created_at);
    const inner = byAgent.get(a) ?? new Map<string, BriefingItem[]>();
    const dayArr = inner.get(d) ?? [];
    dayArr.push(item);
    inner.set(d, dayArr);
    byAgent.set(a, inner);
    const t = item.created_at ? new Date(item.created_at).getTime() : 0;
    if (!agentLatest.has(a) || (agentLatest.get(a) ?? 0) < t) {
      agentLatest.set(a, t);
    }
  }
  const orderedAgents = Array.from(byAgent.keys()).sort(
    (a, b) => (agentLatest.get(b) ?? 0) - (agentLatest.get(a) ?? 0),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {orderedAgents.map((agent) => {
        const inner = byAgent.get(agent)!;
        return (
          <section key={agent} className="space-y-4">
            <h2 className="text-sm font-semibold tracking-wide text-foreground">
              {agentLabel(agent)}
            </h2>
            {Array.from(inner.entries()).map(([day, dayItems]) => (
              <div key={day} className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {day}
                </h3>
                <div className="space-y-3">
                  {dayItems.map((item) => (
                    <BriefingCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
