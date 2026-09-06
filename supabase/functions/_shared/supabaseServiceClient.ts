// ============================================================
// getServiceClient — shared Supabase client using the service-role
// key, for Stored Value Edge Functions that need to read/write
// stored_value_accounts / stored_value_transactions and call
// spend_stored_value() / topup_stored_value().
//
// Those tables have RLS enabled with zero policies, and those two
// functions have execute revoked from anon/authenticated (see
// README.md's "Stored Value" section) — the service-role key is the
// only credential that can reach any of it, since service_role
// bypasses RLS in Supabase.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into
// every Edge Function's environment by Supabase — nothing to set
// manually.
// ============================================================

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

let client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (client) return client;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in this Edge Function's environment"
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return client;
}
