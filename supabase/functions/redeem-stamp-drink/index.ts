// ============================================================
// redeem-stamp-drink
//
// Verifies the caller's LIFF ID token, then re-derives this week's
// Weekday Stamp Card unlocked/redeemed state itself (via the same
// _shared/stampProgress.ts get-stamp-progress uses) — never trusts a
// client-supplied "unlocked" claim. Customer-initiated, like
// spend-stored-value; no staff PIN involved.
//
// Rejects unless: this week is unlocked, not already redeemed, AND
// today is actually Friday (Asia/Taipei) — all three re-checked here,
// not assumed from whatever the client sent. On success, inserts into
// stamp_redemptions; the (user_id, week_start) primary key rejects a
// concurrent double-redeem atomically (surfaced as the same
// already_redeemed error a plain pre-check would give).
//
// order_id is accepted as-is and not cross-checked against a real
// orders row yet, same as spend-stored-value's order_id today — that
// wiring is a later pass, not part of this one.
//
// Request:  POST { id_token, order_id }
// Success:  200 { ok: true, weekStart }
// Failure:  401 { ok: false, code, error }        (bad/expired/missing token)
//           400 { ok: false, code: "invalid_input", error }
//           409 { ok: false, code: "not_friday" | "not_unlocked" | "already_redeemed", error }
//           500 { ok: false, code: "db_error", error }
// ============================================================

import { verifyLineToken, LineTokenVerificationError } from "../_shared/verifyLineToken.ts";
import { getServiceClient } from "../_shared/supabaseServiceClient.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { computeStampProgress } from "../_shared/stampProgress.ts";

const FRIDAY = 5; // Date.getUTCDay()/taipeiNow().dayOfWeek convention: 0=Sun..6=Sat

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

  let body: { id_token?: string; order_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON: { id_token, order_id }" }, 400);
  }

  if (!body.order_id || typeof body.order_id !== "string") {
    return json({ ok: false, code: "invalid_input", error: "order_id is required" }, 400);
  }

  let userId: string;
  try {
    userId = await verifyLineToken(body.id_token ?? "");
  } catch (err) {
    if (err instanceof LineTokenVerificationError) {
      return json({ ok: false, code: err.code, error: err.message }, 401);
    }
    return json({ ok: false, code: "unknown", error: String(err) }, 500);
  }

  const supabase = getServiceClient();

  let progress;
  try {
    progress = await computeStampProgress(supabase, userId);
  } catch (err) {
    console.error("[redeem-stamp-drink] progress check failed", err);
    return json({ ok: false, code: "db_error", error: String(err) }, 500);
  }

  if (progress.todayDayOfWeek !== FRIDAY) {
    return json(
      { ok: false, code: "not_friday", error: "Free drink redemption is only available on Friday" },
      409
    );
  }
  if (!progress.unlocked) {
    return json(
      { ok: false, code: "not_unlocked", error: "This week's stamp card is not complete" },
      409
    );
  }
  if (progress.redeemed) {
    return json({ ok: false, code: "already_redeemed", error: "Already redeemed this week" }, 409);
  }

  const { error: insertError } = await supabase
    .from("stamp_redemptions")
    .insert({ user_id: userId, week_start: progress.weekStart, order_id: body.order_id });

  if (insertError) {
    // Postgres unique_violation — a concurrent redeem on another device
    // already won this exact race. Same error code the pre-check above
    // would have given if it had run a moment later.
    if (insertError.code === "23505") {
      return json({ ok: false, code: "already_redeemed", error: "Already redeemed this week" }, 409);
    }
    console.error("[redeem-stamp-drink] insert failed", insertError);
    return json({ ok: false, code: "db_error", error: insertError.message }, 500);
  }

  return json({ ok: true, weekStart: progress.weekStart }, 200);
});
