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

// userId comes from the current session's LINE login (see
// syncMemberState()/loginWithLine() in app.js) — null for an anonymous
// guest checkout, exactly as every order worked before Membership
// existed. isTest comes from isTesterMode() below — true only for a
// logged-in user flagged as a tester, so their orders land in
// staff.html's Test Orders section instead of the live kitchen queue.
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
// FEATURE FLAGS — no longer a login gate. Membership login is
// available to everyone now, by their own choice (see
// syncMemberState()/loginWithLine() in app.js) — isTesterMode() has
// nothing to do with whether someone CAN log in anymore.
//
// Its purpose now: once someone IS logged in, decide whether THEIR
// orders get flagged is_test = true, so the shop owner's own testing
// orders land in staff.html's separate Test Orders section instead of
// the live kitchen queue/auto-print. If you're reading this because
// you're wondering whether this is dead code left over from the old
// gate — it isn't; it's called from syncLoggedInProfile() in app.js
// on every login, and its result flows into insertOrder()'s isTest
// param exactly like before, just no longer gating login itself.
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
