import type Anthropic from '@anthropic-ai/sdk';
import type { SessionContext } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export type KaleemPreferences = {
  autopilot_level: 'approve_every' | 'approve_outside_rules' | 'auto';
  communication_style: 'terse' | 'detailed';
  risk_tolerance: 'conservative' | 'balanced' | 'aggressive';
  min_margin_floor_pct: number;
  max_scarcity_premium_pct: number;
  notification_channels: Array<'inbox' | 'email' | 'sms'>;
};

const DEFAULT_PREFERENCES: KaleemPreferences = {
  autopilot_level: 'approve_every',
  communication_style: 'terse',
  risk_tolerance: 'balanced',
  min_margin_floor_pct: 25,
  max_scarcity_premium_pct: 200,
  notification_channels: ['inbox'],
};

async function getPharmacy(id: string) {
  const supabase = createClient();
  const { data } = await supabase.from('pharmacies').select('*').eq('id', id).single();
  return data ?? null;
}

async function getKaleemPreferences(pharmacyId: string): Promise<KaleemPreferences> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('memory')
    .select('metadata')
    .eq('pharmacy_id', pharmacyId)
    .eq('kind', 'preferences')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return DEFAULT_PREFERENCES;
  const meta = (data as { metadata: unknown }).metadata;
  if (!meta || typeof meta !== 'object') return DEFAULT_PREFERENCES;
  return { ...DEFAULT_PREFERENCES, ...(meta as Partial<KaleemPreferences>) };
}

async function getAccountHealthSnapshot(pharmacyId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('health_metrics')
    .select('platform, metric, value, captured_at')
    .eq('pharmacy_id', pharmacyId)
    .order('captured_at', { ascending: false })
    .limit(20);
  if (error || !data || data.length === 0) return null;
  return data;
}

async function getRecentBriefings(pharmacyId: string, n: number) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('briefings')
    .select('id, briefing_type, title, summary, urgency, confidence, created_at')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })
    .limit(n);
  if (error || !data) return [];
  return data as Array<{ created_at: string; summary: string; title: string }>;
}

const COS_PERSONA_TEXT = `You are Kaleem's Chief of Staff for his pharmacy's Amazon/eBay OTC business.

You have read access to every table in his Supabase DB via the provided tools — products, orders, listings, prices, stock, signals, health metrics, briefings, memory. You also can enqueue minicrew jobs via enqueue_job for deep analysis tasks.

# How to respond
- Be terse and direct. Kaleem is busy at the pharmacy counter. Short sentences. No vague generalities.
- Back every factual claim with data from tools. When uncertain, say so.
- When he asks about a SKU, product, or trend, use tools to pull real numbers before answering.
- When he asks "should I list X?" — pull the data, reason about it, give a recommendation with confidence level.
- Offer to enqueue a deeper analysis job if the question is bigger than a direct query can handle.

# What you can do
- Answer questions about products, orders, P&L, history, memory of past decisions
- Draft emails, listing copy, customer replies
- Explain past agent decisions (pull from audit log / memory)
- Enqueue deep-analysis jobs via minicrew (e.g. ad-hoc Research Analyst pass)

# What you never do
- Never guess or fabricate data. Use tools.
- Never give medical advice (Kaleem is the licensed pharmacist — flag medical questions to him).
- Never take destructive actions (no listing changes, no purchases — only information and job enqueue).`;

export async function buildSystemPrompt(
  session: SessionContext,
): Promise<Anthropic.TextBlockParam[]> {
  const [pharmacy, preferences, accountHealth, recentBriefings] = await Promise.all([
    getPharmacy(session.pharmacyId),
    getKaleemPreferences(session.pharmacyId),
    getAccountHealthSnapshot(session.pharmacyId),
    getRecentBriefings(session.pharmacyId, 5),
  ]);

  return [
    {
      type: 'text',
      text: COS_PERSONA_TEXT,
      // cache_control omitted in Phase 1 — persona is too small to benefit from prompt caching.
    },
    {
      type: 'text',
      text: `# Current pharmacy context
${JSON.stringify({ pharmacy, preferences, accountHealth }, null, 2)}

# Recent briefings (last 5)
${recentBriefings.map((b) => `- [${b.created_at}] ${b.summary}`).join('\n')}

# Today
${new Date().toISOString()}`,
    },
  ];
}
