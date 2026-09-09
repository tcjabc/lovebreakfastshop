// ============================================================
// get-stored-value-transactions
//
// Verifies the caller's LIFF ID token, then reads their own Stored
// Value transaction history — top-ups and deductions (and, if ever
// used, refunds — see stored_value_transactions' type check
// constraint in README.md; nothing currently inserts that type, but
// this doesn't assume it never will). Same identity-verification
// pattern as get-stored-value-balance/spend-stored-value: never
// trusts a client-supplied user_id, always re-derives it from the
// verified token. Uses the service-role client since
// stored_value_transactions has zero RLS policies (see README.md's
// "Stored Value" section) — unreachable via the anon/publishable key
// even for a member's own rows.
//
// Request:  POST { id_token }
// Success:  200 { ok: true, transactions: [{ id, amount, type, created_at }] }
//           (newest first, capped at 50 — no order itemization here,
//           just top-up/deduction history; order_id/staff_note aren't
//           returned since the client has no use for either)
// Failure:  401 { ok: false, code, error }  (bad/expired/missing token)
//           500 { ok: false, code: "db_error", error }
// ============================================================

import { verifyLineToken, LineTokenVerificationError } from "../_shared/verifyLineToken.ts";
import { getServiceClient } from "../_shared/supabaseServiceClient.ts";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_TRANSACTIONS = 50;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  let body: { id_token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON: { id_token }" }, 400);
  }

  let sub: string;
  try {
    sub = await verifyLineToken(body.id_token ?? "");
  } catch (err) {
    if (err instanceof LineTokenVerificationError) {
      return json({ ok: false, code: err.code, error: err.message }, 401);
    }
    return json({ ok: false, code: "unknown", error: String(err) }, 500);
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("stored_value_transactions")
    .select("id, amount, type, created_at")
    .eq("user_id", sub)
    .order("created_at", { ascending: false })
    .limit(MAX_TRANSACTIONS);

  if (error) {
    console.error("[get-stored-value-transactions] query failed", error);
    return json({ ok: false, code: "db_error", error: error.message }, 500);
  }

  return json({ ok: true, transactions: data ?? [] }, 200);
});
