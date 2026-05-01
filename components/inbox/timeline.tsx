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

  const groups = new Map<string, BriefingItem[]>();
  for (const item of items) {
    const key = dayBucket(item.created_at);
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {Array.from(groups.entries()).map(([day, dayItems]) => (
        <section key={day} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {day}
          </h2>
          <div className="space-y-3">
            {dayItems.map((item) => (
              <BriefingCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
