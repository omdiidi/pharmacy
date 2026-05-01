// Cron-safe / standalone-Node-safe Supabase service-role client.
// Unlike `lib/supabase/server.ts`, this does NOT call `cookies()` from `next/headers`,
// so it can be used from cron scripts, agents, and other non-request contexts.

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

export function createAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'createAdminClient: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
