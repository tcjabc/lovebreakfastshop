// ============================================================
// member-favorites
//
// A logged-in customer's favourites (the ☆/★ stars and the 我的最愛
// row in app.js). Verifies the caller's LIFF ID token; the user id is
// ONLY LINE's verified `sub` — never anything in the request body — so
// nobody can read or change another member's favourites.
//
// Request:  POST { id_token, action, item_id? }
//   action "list"                  → the member's favourited item ids
//   action "add",    item_id: str  → add (item_id must be on menu.json;
//                                    re-adding an existing one is fine)
//   action "remove", item_id: str  → remove (no menu check, so an item
//                                    that has left the menu can still be
//                                    un-favourited)
// Success:  200 { ok: true, item_ids: [...] }   — the member's full list
//                                                 after the action
// Failure:  { ok: false, code, error }
//   400 invalid_request / unknown_item   401 auth_invalid
//   503 auth_unavailable / menu_unavailable   500 server_error
// ============================================================

import { verifyLineTokenClaims, LineTokenVerificationError } from "../_shared/verifyLineToken.ts";
import { getServiceClient } from "../_shared/supabaseServiceClient.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getCachedMenu, menuItemIds } from "../_shared/menuCache.ts";

const ACTIONS = new Set(["list", "add", "remove"]);
const MAX_ITEM_ID_LENGTH = 64;

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
    return fail(400, "invalid_request", "Body must be JSON: { id_token, action, item_id? }");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "invalid_request", "Body must be a JSON object: { id_token, action, item_id? }");
  }
  if (body.id_token !== undefined && body.id_token !== null && typeof body.id_token !== "string") {
    return fail(400, "invalid_request", "id_token must be a string");
  }
  const action = body.action;
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return fail(400, "invalid_request", 'action must be "list", "add" or "remove"');
  }
  const itemId = body.item_id;
  if (action !== "list" && (typeof itemId !== "string" || itemId === "" || itemId.length > MAX_ITEM_ID_LENGTH)) {
    return fail(400, "invalid_request", "item_id must be a non-empty string");
  }

  let userId: string;
  try {
    userId = (await verifyLineTokenClaims((body.id_token as string) ?? "")).sub;
  } catch (err) {
    if (err instanceof LineTokenVerificationError) {
      if (err.code === "network" || err.code === "config" || err.code === "unknown") {
        console.error("[member-favorites] LINE verification unavailable", err);
        return fail(503, "auth_unavailable", "Could not verify LINE login right now");
      }
      return fail(401, "auth_invalid", "LINE login is invalid or expired");
    }
    console.error("[member-favorites] unexpected verification error", err);
    return fail(500, "server_error", "Could not update favourites");
  }

  try {
    const supabase = getServiceClient();

    if (action === "add") {
      let onMenu: Set<string>;
      try {
        onMenu = menuItemIds(await getCachedMenu());
      } catch (err) {
        console.error("[member-favorites] menu.json unavailable — refusing add", err);
        return fail(503, "menu_unavailable", "Could not check the menu right now");
      }
      if (!onMenu.has(itemId as string)) return fail(400, "unknown_item", `unknown item "${itemId}"`);

      const { error } = await supabase
        .from("favorites")
        .upsert({ user_id: userId, item_id: itemId }, { onConflict: "user_id,item_id", ignoreDuplicates: true });
      if (error) {
        console.error("[member-favorites] add failed", error);
        return fail(500, "server_error", "Could not update favourites");
      }
    } else if (action === "remove") {
      const { error } = await supabase.from("favorites").delete().eq("user_id", userId).eq("item_id", itemId);
      if (error) {
        console.error("[member-favorites] remove failed", error);
        return fail(500, "server_error", "Could not update favourites");
      }
    }

    const { data, error } = await supabase
      .from("favorites")
      .select("item_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[member-favorites] list failed", error);
      return fail(500, "server_error", "Could not load favourites");
    }
    return json({ ok: true, item_ids: (data ?? []).map((r) => r.item_id) }, 200);
  } catch (err) {
    console.error("[member-favorites] unexpected error", err);
    return fail(500, "server_error", "Could not update favourites");
  }
});
