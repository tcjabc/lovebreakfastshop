// ============================================================
// topup-stored-value
//
// Verifies a staff PIN (STAFF_PIN secret, via verifyStaffPin.ts), then
// calls topup_stored_value() (security definer, execute revoked from
// anon/authenticated — see README.md's "Stored Value" section) for a
// user_id supplied directly in the request.
//
// There's no staff search UI yet to pick a member from — for this
// pass, testing means passing a known real user_id by hand, same as
// the debug functions did. That UI is a separate, later slice.
//
// Request:  POST { pin, user_id, amount, staff_note? }
//   amount must be a positive integer (whole NT$, matching orders.total).
// Success:  200 { ok: true, balance: number }   -- new balance after top-up
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

  let body: { pin?: string; user_id?: string; amount?: number; staff_note?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON: { pin, user_id, amount, staff_note? }" }, 400);
  }

  if (!verifyStaffPin(body.pin ?? "")) {
    return json({ ok: false, code: "invalid_pin", error: "Incorrect staff PIN" }, 401);
  }

  if (!body.user_id || typeof body.user_id !== "string") {
    return json({ ok: false, code: "invalid_input", error: "user_id is required" }, 400);
  }
  if (!Number.isInteger(body.amount) || (body.amount as number) <= 0) {
    return json(
      { ok: false, code: "invalid_input", error: "amount must be a positive integer" },
      400
    );
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("topup_stored_value", {
    p_user_id: body.user_id,
    p_amount: body.amount,
    p_staff_note: body.staff_note ?? null,
  });

  if (error) {
    console.error("[topup-stored-value] rpc failed", error);
    return json({ ok: false, code: "db_error", error: error.message }, 500);
  }

  return json({ ok: true, balance: data }, 200);
});
