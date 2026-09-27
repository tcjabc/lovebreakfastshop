// ============================================================
// upsert-member
//
// Called on every customer login (app.js syncLoggedInProfile()).
// Verifies the caller's LIFF ID token and upserts their `members` row
// from the claims LINE itself vouched for — user_id = `sub`,
// display_name = `name`, picture_url = `picture` — NEVER from anything
// in the request body, so nobody can create or rename someone else's
// member record. last_seen_at is set to now.
//
// A claim LINE didn't include (e.g. no picture) leaves the stored value
// as it was instead of overwriting it with null.
//
// Request:  POST { id_token }
// Success:  200 { ok: true, member: { user_id, display_name, picture_url, last_seen_at, created_at } }
// Failure:  { ok: false, code, error }
//   400 invalid_request   401 auth_invalid   503 auth_unavailable   500 server_error
// ============================================================

import { verifyLineTokenClaims, LineTokenVerificationError } from "../_shared/verifyLineToken.ts";
import { getServiceClient } from "../_shared/supabaseServiceClient.ts";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function fail(status: number, code: string, error: string) {
  return json({ ok: false, code, error }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return fail(405, "invalid_request", "POST only");
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, "invalid_request", "Body must be JSON: { id_token }");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "invalid_request", "Body must be a JSON object: { id_token }");
  }
  if (body.id_token !== undefined && body.id_token !== null && typeof body.id_token !== "string") {
    return fail(400, "invalid_request", "id_token must be a string");
  }

  let claims;
  try {
    claims = await verifyLineTokenClaims((body.id_token as string) ?? "");
  } catch (err) {
    if (err instanceof LineTokenVerificationError) {
      if (err.code === "network" || err.code === "config" || err.code === "unknown") {
        console.error("[upsert-member] LINE verification unavailable", err);
        return fail(503, "auth_unavailable", "Could not verify LINE login right now");
      }
      return fail(401, "auth_invalid", "LINE login is invalid or expired");
    }
    console.error("[upsert-member] unexpected verification error", err);
    return fail(500, "server_error", "Could not update the member record");
  }

  try {
    const supabase = getServiceClient();
    const row: Record<string, unknown> = { user_id: claims.sub, last_seen_at: new Date().toISOString() };
    if (claims.name != null) row.display_name = claims.name;
    if (claims.picture != null) row.picture_url = claims.picture;

    const { data, error } = await supabase
      .from("members")
      .upsert(row, { onConflict: "user_id" })
      .select("user_id, display_name, picture_url, last_seen_at, created_at")
      .single();
    if (error) {
      console.error("[upsert-member] upsert failed", error);
      return fail(500, "server_error", "Could not update the member record");
    }
    return json({ ok: true, member: data }, 200);
  } catch (err) {
    console.error("[upsert-member] unexpected error", err);
    return fail(500, "server_error", "Could not update the member record");
  }
});
