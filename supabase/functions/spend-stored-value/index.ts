// ============================================================
// spend-stored-value
//
// Verifies the caller's LIFF ID token, then calls spend_stored_value()
// (security definer, execute revoked from anon/authenticated — see
// README.md's "Stored Value" section) for the verified sub.
//
// order_id is accepted as a plain string for now and is NOT
// cross-checked against a real orders row yet — that wiring happens
// when this is connected to real checkout, a separate later pass.
//
// Request:  POST { id_token, amount, order_id }
//   amount must be a positive integer (whole NT$, matching orders.total).
// Success:  200 { ok: true, balance: number }   -- new balance after spend
// Failure:  401 { ok: false, code, error }        (bad/expired/missing token)
//           400 { ok: false, code: "invalid_input", error }
//           409 { ok: false, code: "insufficient_funds", error }
//           500 { ok: false, code: "db_error", error }
// ============================================================

import { verifyLineToken, LineTokenVerificationError } from "../_shared/verifyLineToken.ts";
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

  let body: { id_token?: string; amount?: number; order_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON: { id_token, amount, order_id }" }, 400);
  }

  if (!Number.isInteger(body.amount) || (body.amount as number) <= 0) {
    return json(
      { ok: false, code: "invalid_input", error: "amount must be a positive integer" },
      400
    );
  }
  if (!body.order_id || typeof body.order_id !== "string") {
    return json(
      { ok: false, code: "invalid_input", error: "order_id is required" },
      400
    );
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
  const { data, error } = await supabase.rpc("spend_stored_value", {
    p_user_id: sub,
    p_amount: body.amount,
    p_order_id: body.order_id,
  });

  if (error) {
    if (error.message?.includes("insufficient_funds")) {
      return json(
        { ok: false, code: "insufficient_funds", error: "Not enough stored value balance" },
        409
      );
    }
    console.error("[spend-stored-value] rpc failed", error);
    return json({ ok: false, code: "db_error", error: error.message }, 500);
  }

  return json({ ok: true, balance: data }, 200);
});
