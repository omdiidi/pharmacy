import { createUserClient } from '@/lib/supabase/server';

export type SessionContext = { userId: string; email: string; pharmacyId: string };

let cachedAllowed: string[] | null = null;

export function getAllowedEmails(): string[] {
  if (cachedAllowed !== null) return cachedAllowed;
  cachedAllowed = (process.env.ALLOWED_USER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return cachedAllowed;
}

export async function requireAuthenticatedUser(): Promise<SessionContext | null> {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Re-check allowlist on every request — revocation must take effect immediately.
  const email = user.email?.toLowerCase();
  if (!email || !getAllowedEmails().includes(email)) return null;

  const { data: access, error } = await supabase
    .from('user_pharmacy_access')
    .select('pharmacy_id')
    .eq('user_id', user.id)
    .single();
  if (error || !access) return null;

  return { userId: user.id, email, pharmacyId: (access as { pharmacy_id: string }).pharmacy_id };
}
