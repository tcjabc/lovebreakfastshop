// ============================================================
// get-stored-value-balance-staff
//
// Staff-side balance lookup, gated by the staff PIN (verifyStaffPin.ts)
// rather than a LIFF token — staff have no LINE identity of their own,
// so they can't use the customer-facing get-stored-value-balance
// function to check someone else's balance before deciding a top-up
// amount. Plain select, no mutation — same PIN gate as topup-stored-value,
// used by staff.html's "會員儲值" panel right before a top-up.
//
// Request:  POST { pin, user_id }
// Success:  200 { ok: true, balance: number }
// Failure:  401 { ok: false, code: "invalid_pin", error }
//           400 { ok: false, code: "invalid_input", error }
//           500 { ok: false, code: "db_error", error }
// ============================================================

import { verifyStaffPin } from "../_shared/verifyStaffPin.ts";
import { getServiceClient } from "../_shared/supabaseServiceClient.ts";
import { corsHeaders } from "../_shared/cors.ts";

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

  let body: { pin?: string; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON: { pin, user_id }" }, 400);
  }

  if (!verifyStaffPin(body.pin ?? "")) {
    return json({ ok: false, code: "invalid_pin", error: "Incorrect staff PIN" }, 401);
  }
  if (!body.user_id || typeof body.user_id !== "string") {
    return json({ ok: false, code: "invalid_input", error: "user_id is required" }, 400);
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("stored_value_accounts")
    .select("balance")
    .eq("user_id", body.user_id)
    .maybeSingle();

  if (error) {
    console.error("[get-stored-value-balance-staff] query failed", error);
    return json({ ok: false, code: "db_error", error: error.message }, 500);
  }

  // No row yet = never topped up = balance 0, not an error.
  return json({ ok: true, balance: data?.balance ?? 0 }, 200);
});
