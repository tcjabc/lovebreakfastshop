// ============================================================
// get-stored-value-balance
//
// Verifies the caller's LIFF ID token, then reads their stored-value
// balance using the service-role client (stored_value_accounts has no
// RLS policies — the anon key can't read it directly, see README.md's
// "Stored Value" section). A member who has never been topped up has
// no row at all — that reads as balance 0, not an error.
//
// Request:  POST { id_token }
// Success:  200 { ok: true, balance: number }
// Failure:  401 { ok: false, code: "auth_invalid", error }  (bad/expired/missing token)
//           503 { ok: false, code: "auth_unavailable", error }  (LINE unreachable)
//           500 { ok: false, code: "db_error"|"unknown", error }
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
      if (err.code === "network" || err.code === "config" || err.code === "unknown") {
        console.error("[get-stored-value-balance] LINE verification unavailable", err);
        return json({ ok: false, code: "auth_unavailable", error: "Could not verify LINE login right now" }, 503);
      }
      // Normalised to "auth_invalid" (was the raw err.code, e.g. "expired")
      // to match place-order/upsert-member/member-favorites/member-orders —
      // the client treats one consistent code as "needs a fresh login".
      return json({ ok: false, code: "auth_invalid", error: "LINE login is invalid or expired" }, 401);
    }
    return json({ ok: false, code: "unknown", error: String(err) }, 500);
  }

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("stored_value_accounts")
      .select("balance")
      .eq("user_id", sub)
      .maybeSingle();

    if (error) {
      console.error("[get-stored-value-balance] query failed", error);
      return json({ ok: false, code: "db_error", error: error.message }, 500);
    }

    // No row yet = never topped up = balance 0, not an error.
    return json({ ok: true, balance: data?.balance ?? 0 }, 200);
  } catch (err) {
    // getServiceClient() itself can throw (e.g. missing env var); without
    // this, that propagates as a raw platform error instead of JSON, and
    // the client sees it as an opaque network failure.
    console.error("[get-stored-value-balance] unexpected failure", err);
    return json({ ok: false, code: "unknown", error: String(err) }, 500);
  }
});
