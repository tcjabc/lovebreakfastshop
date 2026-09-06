// ============================================================
// get-stamp-progress
//
// Verifies the caller's LIFF ID token, then reports this week's
// Weekday Stamp Card progress: which of Mon-Thu (Asia/Taipei) the
// member's order spend reached NT$85, whether all four unlock Friday's
// free drink, and whether they've already redeemed it this week. All
// of the actual computation lives in _shared/stampProgress.ts, shared
// with redeem-stamp-drink so the two can't compute this two different
// ways.
//
// Request:  POST { id_token }
// Success:  200 { ok: true, days: [mon,tue,wed,thu], unlocked, redeemed, weekStart }
// Failure:  401 { ok: false, code, error }  (bad/expired/missing token)
//           500 { ok: false, code: "db_error", error }
// ============================================================

import { verifyLineToken, LineTokenVerificationError } from "../_shared/verifyLineToken.ts";
import { getServiceClient } from "../_shared/supabaseServiceClient.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { computeStampProgress } from "../_shared/stampProgress.ts";

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

  let userId: string;
  try {
    userId = await verifyLineToken(body.id_token ?? "");
  } catch (err) {
    if (err instanceof LineTokenVerificationError) {
      return json({ ok: false, code: err.code, error: err.message }, 401);
    }
    return json({ ok: false, code: "unknown", error: String(err) }, 500);
  }

  try {
    const supabase = getServiceClient();
    const progress = await computeStampProgress(supabase, userId);
    return json(
      {
        ok: true,
        days: progress.days,
        unlocked: progress.unlocked,
        redeemed: progress.redeemed,
        weekStart: progress.weekStart,
      },
      200
    );
  } catch (err) {
    console.error("[get-stamp-progress] failed", err);
    return json({ ok: false, code: "db_error", error: String(err) }, 500);
  }
});
