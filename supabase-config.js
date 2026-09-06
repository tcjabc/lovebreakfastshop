// ============================================================
// SUPABASE CONFIG
// Fill these in after creating a free project at supabase.com
// (see README.md → "Step 6: Set up Supabase")
// ============================================================

const SUPABASE_URL = "https://jqfimztzvlckwjkrqonh.supabase.co"; // e.g. https://xxxx.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_jy24Bn15qO8O2ZsWOBdyxw_W8bxBZ8L";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Average minutes to prepare one item — used for pickup time estimate.
// Adjust to match reality once you have real timing data.
const AVG_MINUTES_PER_ITEM = 3;
const QUEUE_BUFFER_MINUTES = 4; // slack per order already ahead in queue

function makeShortId() {
  // Short human-friendly order code, e.g. "A482"
  return (
    String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
    Math.floor(100 + Math.random() * 900)
  );
}

// userId/isTest are only ever non-null/true for a tester (see
// maybeTesterLogin() in app.js) — for everyone else these are
// null/false exactly as before this column pair existed.
async function insertOrder({ items, total, note, userId, isTest }) {
  const shortId = makeShortId();
  const { data, error } = await supabaseClient
    .from("orders")
    .insert([
      {
        short_id: shortId,
        items,
        total,
        note: note || null,
        status: "pending",
        user_id: userId || null,
        is_test: Boolean(isTest),
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Upsert-only member record, keyed to the LINE user id — insert on
// first sight, otherwise refresh the display fields + last_seen_at
// without touching created_at. Called once per checkout for a logged-
// in tester (see maybeTesterLogin()/submitOrder() in app.js). Never
// throws — a members-table hiccup shouldn't be able to block an order
// from going through, same reasoning as every other LIFF-adjacent call
// in this app.
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

async function getQueueCount() {
  const { count, error } = await supabaseClient
    .from("orders")
    .select("*", { count: "exact", head: true })
    .in("status", ["pending", "preparing"]);

  if (error) {
    console.error("Queue count failed", error);
    return 0;
  }
  return count || 0;
}

function estimateWaitMinutes(itemCount, queueAhead) {
  const prepTime = itemCount * AVG_MINUTES_PER_ITEM;
  const queueTime = queueAhead * QUEUE_BUFFER_MINUTES;
  return Math.max(10, prepTime + queueTime); // floor of 10 min
}

// ============================================================
// FEATURE FLAGS — tester gating for in-progress features (right now:
// the LIFF login flow in app.js, ahead of it becoming mandatory for
// everyone). See README.md → "Set up feature flags" for the table's
// SQL and RLS policy.
//
// THE SINGLE GATE CHECK: this is the only place in the codebase that
// should ever decide "is this user a tester" — every call site should
// call isTesterMode(), never re-implement or inline this check. That
// keeps toggling a tester on/off a pure Supabase row update
// (`update feature_flags set is_tester = true where line_user_id =
// '...'`), never a code change or redeploy. When the gated feature
// ships for everyone, delete this function and its call site(s)
// rather than leaving a second copy of the check behind.
//
// Note this can only recognize a user who already has a LINE user id
// to check — i.e. someone who has been through liff.getProfile() at
// least once before (see maybeTesterLogin() in app.js). Seeding the
// very first tester row therefore needs that id obtained once
// manually (e.g. a temporary console.log of liff.getProfile() during
// testing) before it can be inserted into this table.
// ============================================================
async function isTesterMode(userId) {
  if (!userId) return false; // no LINE identity yet — never a tester

  const { data, error } = await supabaseClient
    .from("feature_flags")
    .select("is_tester")
    .eq("line_user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[FeatureFlags] isTesterMode check failed — treating as non-tester", error);
    return false; // fail closed: never accidentally expose a WIP flow
  }
  return Boolean(data && data.is_tester);
}
