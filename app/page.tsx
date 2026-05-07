import { redirect } from 'next/navigation';

import {
  Timeline,
  type BriefingItem,
  type InboxState,
  type ProposedAction,
} from '@/components/inbox/timeline';
import { requireAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type InboxRow = {
  id: string;
  state: InboxState;
  acted_at: string | null;
  action_taken: string | null;
  created_at: string | null;
  briefing: {
    title: string | null;
    summary: string | null;
    rationale: string | null;
    urgency: number | null;
    confidence: number | null;
    briefing_type: string | null;
    source_agent: string | null;
    proposed_actions: ProposedAction[] | null;
  } | null;
};

type AuditRow = {
  id: string;
  target_entity_id: string | null;
  undo_window_expires_at: string | null;
  undone_at: string | null;
  created_at: string | null;
};

export default async function InboxPage() {
  const session = await requireAuthenticatedUser();
  if (!session) redirect('/sign-in');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('inbox_items')
    .select(
      `
      id,
      state,
      acted_at,
      action_taken,
      created_at,
      briefing:briefings (
        title,
        summary,
        rationale,
        urgency,
        confidence,
        briefing_type,
        source_agent,
        proposed_actions
      )
    `,
    )
    .eq('pharmacy_id', session.pharmacyId)
    .neq('state', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = error ? [] : ((data ?? []) as unknown as InboxRow[]);

  // Batch-fetch the latest non-undo audit_log row per acted inbox_item.
  // Supabase JS LEFT JOIN can't express "latest row per parent", so we group
  // in TS after a single bounded query.
  const actedIds = rows.filter((r) => r.state === 'acted').map((r) => r.id);
  const auditByTarget = new Map<string, AuditRow>();
  if (actedIds.length > 0) {
    const { data: auditRows } = await supabase
      .from('audit_log')
      .select('id, target_entity_id, undo_window_expires_at, undone_at, created_at, action')
      .eq('target_entity_type', 'inbox_items')
      .in('target_entity_id', actedIds)
      .not('action', 'like', 'undo:%')
      .order('created_at', { ascending: false });
    for (const a of (auditRows ?? []) as Array<AuditRow & { action: string }>) {
      if (!a.target_entity_id) continue;
      // Order is desc, so first hit is latest.
      if (!auditByTarget.has(a.target_entity_id)) {
        auditByTarget.set(a.target_entity_id, a);
      }
    }
  }

  const items: BriefingItem[] = rows
    .filter((r) => r.briefing)
    .map((r) => {
      const audit = auditByTarget.get(r.id);
      return {
        id: r.id,
        title: r.briefing!.title ?? 'Untitled briefing',
        summary: r.briefing!.summary,
        rationale: r.briefing!.rationale,
        urgency: r.briefing!.urgency,
        confidence: r.briefing!.confidence,
        briefing_type: r.briefing!.briefing_type,
        source_agent: r.briefing!.source_agent,
        created_at: r.created_at,
        proposed_actions: r.briefing!.proposed_actions,
        state: r.state,
        acted_at: r.acted_at,
        action_taken: r.action_taken,
        audit_log_id: audit?.id ?? null,
        undo_window_expires_at: audit?.undo_window_expires_at ?? null,
        undone_at: audit?.undone_at ?? null,
      };
    })
    .sort((a, b) => {
      const u = (b.urgency ?? 0) - (a.urgency ?? 0);
      if (u !== 0) return u;
      const at = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bt - at;
    });

  return (
    <div className="px-6 py-8 md:px-10">
      <header className="mx-auto max-w-3xl mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Briefings from your specialist agents, ranked by urgency.
        </p>
      </header>
      <Timeline items={items} />
    </div>
  );
}
