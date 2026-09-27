// ============================================================
// SUPABASE CONFIG
// Fill these in after creating a free project at supabase.com
// (see README.md → "Step 6: Set up Supabase")
// ============================================================

const SUPABASE_URL = "https://jqfimztzvlckwjkrqonh.supabase.co"; // e.g. https://xxxx.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_jy24Bn15qO8O2ZsWOBdyxw_W8bxBZ8L";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Upsert-only member record, keyed to the LINE user id — insert on
// first sight, otherwise refresh the display fields + last_seen_at
// without touching created_at. Called once per successful login (see
// syncLoggedInProfile() in app.js), not per order. Never throws — a
// members-table hiccup shouldn't be able to block anything else in
// the app, same reasoning as every other LIFF-adjacent call here.
async function upsertMember(profile) {
  const { error } = await supabaseClient.from("members").upsert(
    {
      user_id: profile.userId,
      display_name: profile.displayName,
      picture_url: profile.pictureUrl || null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("[Members] upsert failed", error);
  }
}

// ============================================================
// FAVOURITES — same permissive "allow all" RLS shape as orders/members
// (see README.md's "Favourites" section), written to directly from
// app.js via this client, no Edge Function — favouriting isn't money.
// ============================================================

// Returns the set of item ids this member has favourited — [] (not a
// throw) on failure, since a favourites-fetch hiccup shouldn't be able
// to block the rest of the menu from rendering.
async function getFavoriteItemIds(userId) {
  const { data, error } = await supabaseClient
    .from("favorites")
    .select("item_id")
    .eq("user_id", userId);

  if (error) {
    console.error("[Favorites] fetch failed", error);
    return [];
  }
  return data.map((row) => row.item_id);
}

// upsert rather than insert — a double-tap racing two inserts for the
// same (user_id, item_id) would otherwise throw on the primary key
// conflict and incorrectly revert toggleFavorite()'s optimistic UI
// flip (app.js) even though the favourite is (still) correctly set.
async function addFavorite(userId, itemId) {
  const { error } = await supabaseClient
    .from("favorites")
    .upsert({ user_id: userId, item_id: itemId }, { onConflict: "user_id,item_id" });
  if (error) throw error;
}

async function removeFavorite(userId, itemId) {
  const { error } = await supabaseClient
    .from("favorites")
    .delete()
    .eq("user_id", userId)
    .eq("item_id", itemId);
  if (error) throw error;
}

// Top `limit` item ids by total quantity across this member's own past
// orders (every order, live or test — this reads a member's own
// history for their own recommendations, not the kitchen queue, so
// is_test doesn't apply the way it does in staff/index.html). [] on fetch
// failure or genuinely no order history — either way the caller (see
// renderMemberPicksRow() in app.js) treats that as "nothing to
// suggest" and hides the row, same as a real empty result.
async function getFrequentlyBoughtItemIds(userId, limit = 5) {
  const { data, error } = await supabaseClient
    .from("orders")
    .select("items")
    .eq("user_id", userId);

  if (error) {
    console.error("[Favorites] order history fetch failed", error);
    return [];
  }

  const counts = {};
  data.forEach((order) => {
    (order.items || []).forEach((item) => {
      counts[item.id] = (counts[item.id] || 0) + item.qty;
    });
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([itemId]) => itemId);
}

// A member's own past orders, most recent first, for the order-history
// view in #order-history-sheet (app.js). Excludes is_test orders (those
// are the shop owner's own checkout testing, not real order history) and
// caps at `limit` with no pagination — this is a grab-and-go shop, not
// something anyone needs years of scrollback for, and the cap keeps the
// query cheap without needing one. [] on failure, same "never block the
// UI over a fetch hiccup" reasoning as every other read here.
async function getMemberOrderHistory(userId, limit = 20) {
  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .eq("user_id", userId)
    .eq("is_test", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[OrderHistory] fetch failed", error);
    return [];
  }
  return data;
}

// ============================================================
// FEATURE FLAGS — no longer a login gate. Membership login is
// available to everyone now, by their own choice (see
// syncMemberState()/loginWithLine() in app.js) — isTesterMode() has
// nothing to do with whether someone CAN log in anymore.
//
// Its purpose now: once someone IS logged in, decide whether THEIR
// orders get flagged is_test = true, so the shop owner's own testing
// orders land in staff/index.html's separate Test Orders section instead of
// the live kitchen queue/auto-print.
//
// NOTE: orders no longer use this result. Since checkout moved to the
// place-order Edge Function, the SERVER decides is_test (it reads
// feature_flags itself for the verified LINE user). This is still
// called from syncLoggedInProfile() in app.js and stored as
// currentMember.isTest, but nothing reads that for ordering any more —
// safe to remove along with currentMember.isTest.
//
// Toggling someone's tester status is still a pure feature_flags row
// update in Supabase (see README.md), never a code change.
// ============================================================
async function isTesterMode(userId) {
  if (!userId) return false; // not logged in — never flagged as a test order

  const { data, error } = await supabaseClient
    .from("feature_flags")
    .select("is_tester")
    .eq("line_user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[FeatureFlags] isTesterMode check failed — treating as a real (non-test) order", error);
    return false; // fail closed: never accidentally drop a real order out of the live queue
  }
  return Boolean(data && data.is_tester);
}