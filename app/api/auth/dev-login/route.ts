import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { checkAuthRateLimit } from '@/lib/auth-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEV_PASSWORD = process.env.DEV_PASSWORD;
const MIN_PWD_LEN = 16;

function isWeakPassword(pwd: string | undefined): boolean {
  if (!pwd) return true;
  if (pwd.length < MIN_PWD_LEN) return true;
  if (/^[0-9]+$/.test(pwd) || /^[a-zA-Z]+$/.test(pwd)) return true;
  return false;
}

const DEFAULT_PHARMACY_ID = '00000000-0000-0000-0000-000000000001';

export async function POST(req: Request) {
  // Per-IP rate limit: 5 attempts/min. Per-replica only (Phase 1).
  const ip = headers().get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = checkAuthRateLimit(`dev-login:${ip}`, { window: 60_000, max: 5 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate-limited' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  // Strict opt-in gate — no NODE_ENV-derived auto-enable.
  const devLoginEnabled = process.env.DEV_LOGIN_ENABLED === 'true';
  if (!devLoginEnabled) {
    return NextResponse.json({ error: 'dev-login disabled' }, { status: 403 });
  }

  if (isWeakPassword(DEV_PASSWORD)) {
    return NextResponse.json(
      { error: 'dev-login misconfigured: set DEV_PASSWORD ≥16 chars, mixed' },
      { status: 503 },
    );
  }

  const { email, password } = (await req.json()) as { email?: string; password?: string };
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  }
  if (password !== DEV_PASSWORD) {
    return NextResponse.json({ error: 'invalid password' }, { status: 401 });
  }

  const allowed = (process.env.ALLOWED_USER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const normalizedEmail = email.toLowerCase().trim();
  if (!allowed.includes(normalizedEmail)) {
    return NextResponse.json({ error: 'email not in ALLOWED_USER_EMAILS' }, { status: 403 });
  }

  // Admin client (service role) — for user creation + bootstrap
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 1. Look up user; create if missing. Do NOT clobber existing passwords on every login.
  const { data: list } = await admin.auth.admin.listUsers();
  let user = list.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: DEV_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) {
      return NextResponse.json({ error: error?.message ?? 'createUser failed' }, { status: 500 });
    }
    user = data.user;
  }

  // 2. Sign in via the user-scoped server client — this writes the session cookie
  const cookieStore = cookies();
  const userClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options });
        },
      },
    },
  );
  const { error: signInErr } = await userClient.auth.signInWithPassword({
    email: normalizedEmail,
    password: DEV_PASSWORD,
  });
  if (signInErr) {
    return NextResponse.json({ error: signInErr.message }, { status: 500 });
  }

  // 3. Bootstrap user_pharmacy_access if missing
  const { data: existing } = await admin
    .from('user_pharmacy_access')
    .select('user_id')
    .eq('user_id', user.id)
    .limit(1);
  if (!existing || existing.length === 0) {
    await admin.from('user_pharmacy_access').insert({
      user_id: user.id,
      pharmacy_id: DEFAULT_PHARMACY_ID,
      role: 'owner',
    });
  }

  return NextResponse.json({ ok: true });
}
