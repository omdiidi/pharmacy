import { redirect } from 'next/navigation';

import { Timeline, type BriefingItem, type ProposedAction } from '@/components/inbox/timeline';
import { requireAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type InboxRow = {
  id: string;
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

export default async function InboxPage() {
  const session = await requireAuthenticatedUser(new Request('http://internal/inbox'));
  if (!session) redirect('/sign-in');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('inbox_items')
    .select(
      `
      id,
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
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (error ? [] : ((data ?? []) as unknown as InboxRow[]));

  const items: BriefingItem[] = rows
    .filter((r) => r.briefing)
    .map((r) => ({
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
    }))
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
