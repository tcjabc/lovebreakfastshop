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

async function insertOrder({ items, total, note }) {
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
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
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
