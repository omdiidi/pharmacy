import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date().toISOString();

  let dbOk = false;
  let dbError: string | undefined;
  try {
    const supabase = createClient();
    const { error } = await supabase.from('pharmacies').select('id').limit(1);
    if (error) dbError = error.message;
    else dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  // Don't actually call OpenRouter — costs money. Presence of API key is enough.
  const llmOk = !!process.env.OPENROUTER_API_KEY;

  const ok = dbOk && llmOk;
  const body = {
    ok,
    now,
    db: dbOk ? { ok: true } : { ok: false, error: dbError ?? 'unknown error' },
    llm: llmOk
      ? { ok: true, provider: 'openrouter' }
      : { ok: false, error: 'OPENROUTER_API_KEY not set' },
  };

  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
