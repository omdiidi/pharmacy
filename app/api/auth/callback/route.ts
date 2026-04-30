import { NextResponse } from 'next/server';
import { createUserClient, createClient } from '@/lib/supabase/server';
import { getAllowedEmails } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Matches the seeded default pharmacy in supabase/seed.sql.
const DEFAULT_PHARMACY_ID = '00000000-0000-0000-0000-000000000001';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const origin = url.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing-code`);
  }

  const userClient = createUserClient();
  const { error: exchangeError } = await userClient.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(`${origin}/sign-in?error=exchange-failed`);
  }

  const { data: { user } } = await userClient.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!user || !email || !getAllowedEmails().includes(email)) {
    await userClient.auth.signOut();
    return NextResponse.redirect(`${origin}/sign-in?error=not-authorized`);
  }

  // Bootstrap user_pharmacy_access on first sign-in. Service-role client is
  // required because the row is keyed off auth.users(id) and Phase 1 has RLS
  // disabled — but we still want this insert to come from a trusted path.
  const admin = createClient();
  const { data: existing } = await admin
    .from('user_pharmacy_access')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!existing) {
    await admin.from('user_pharmacy_access').insert({
      user_id: user.id,
      pharmacy_id: DEFAULT_PHARMACY_ID,
      role: 'owner',
    });
  }

  return NextResponse.redirect(`${origin}/`);
}
