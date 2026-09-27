// ============================================================
// member-orders
//
// A logged-in customer's own order data, for app.js's order-history
// sheet (訂單紀錄) and the 常買推薦 member-picks row. Verifies the
// caller's LIFF ID token; the user id comes from LINE's verified `sub`,
// never from the request.
//
// Returns:
//   orders — the member's last 20 NON-test orders, newest first, with
//     only what buildOrderHistoryItem() shows: created_at, total,
//     stamp_discount, payment_method, and items trimmed to
//     { name, modifiers, qty }.
//   frequent_item_ids — up to 5 item ids, computed exactly as app.js's
//     old getFrequentlyBoughtItemIds() did: across ALL the member's
//     orders (test ones included — it's their own recommendations, not
//     the kitchen queue), sum qty per item id, sort by total descending,
//     take the top 5; then drop ids no longer in menu.json (the client
//     used to drop those at render time). If menu.json can't be
//     fetched, the ids are returned unfiltered (the app still skips
//     unknown ids itself).
//
// Request:  POST { id_token }
// Success:  200 { ok: true, orders: [...], frequent_item_ids: [...] }
// Failure:  { ok: false, code, error }
//   400 invalid_request   401 auth_invalid   503 auth_unavailable   500 server_error
// ============================================================

import { verifyLineTokenClaims, LineTokenVerificationError } from "../_shared/verifyLineToken.ts";
import { getServiceClient } from "../_shared/supabaseServiceClient.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getCachedMenu, menuItemIds } from "../_shared/menuCache.ts";

const HISTORY_LIMIT = 20;
const FREQUENT_LIMIT = 5;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function fail(status: number, code: string, error: string) {
  return json({ ok: false, code, error }, status);
}

type OrderItem = { id?: string; name?: string; modifiers?: string; qty?: number };

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

  let userId: string;
  try {
    userId = (await verifyLineTokenClaims((body.id_token as string) ?? "")).sub;
  } catch (err) {
    if (err instanceof LineTokenVerificationError) {
      if (err.code === "network" || err.code === "config" || err.code === "unknown") {
        console.error("[member-orders] LINE verification unavailable", err);
        return fail(503, "auth_unavailable", "Could not verify LINE login right now");
      }
      return fail(401, "auth_invalid", "LINE login is invalid or expired");
    }
    console.error("[member-orders] unexpected verification error", err);
    return fail(500, "server_error", "Could not load orders");
  }

  try {
    const supabase = getServiceClient();

    // (a) order history — non-test only, newest first, capped
    const { data: history, error: historyError } = await supabase
      .from("orders")
      .select("created_at, total, stamp_discount, payment_method, items")
      .eq("user_id", userId)
      .eq("is_test", false)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (historyError) {
      console.error("[member-orders] history query failed", historyError);
      return fail(500, "server_error", "Could not load orders");
    }
    const orders = (history ?? []).map((o) => ({
      created_at: o.created_at,
      total: o.total,
      stamp_discount: o.stamp_discount,
      payment_method: o.payment_method,
      items: ((o.items as OrderItem[]) || []).map((i) => ({ name: i.name, modifiers: i.modifiers, qty: i.qty })),
    }));

    // (b) frequently bought — all orders (test included), same algorithm as the old client code.
    // Oldest first, so ties keep first-seen order, as the client's Object.entries() did.
    const { data: all, error: allError } = await supabase
      .from("orders")
      .select("items")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (allError) {
      console.error("[member-orders] frequent-items query failed", allError);
      return fail(500, "server_error", "Could not load orders");
    }
    const counts: Record<string, number> = {};
    for (const order of all ?? []) {
      for (const item of (order.items as OrderItem[]) || []) {
        if (!item || typeof item.id !== "string") continue;
        counts[item.id] = (counts[item.id] || 0) + (Number(item.qty) || 0);
      }
    }
    let frequent = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, FREQUENT_LIMIT)
      .map(([itemId]) => itemId);

    try {
      const onMenu = menuItemIds(await getCachedMenu());
      frequent = frequent.filter((id) => onMenu.has(id));
    } catch (err) {
      console.error("[member-orders] menu.json unavailable — returning frequent ids unfiltered", err);
    }

    return json({ ok: true, orders, frequent_item_ids: frequent }, 200);
  } catch (err) {
    console.error("[member-orders] unexpected error", err);
    return fail(500, "server_error", "Could not load orders");
  }
});
