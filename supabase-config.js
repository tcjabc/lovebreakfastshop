// ============================================================
// SUPABASE CONFIG
// Fill these in after creating a free project at supabase.com
// (see README.md → "Step 6: Set up Supabase")
// ============================================================

const SUPABASE_URL = "https://jqfimztzvlckwjkrqonh.supabase.co"; // e.g. https://xxxx.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_jy24Bn15qO8O2ZsWOBdyxw_W8bxBZ8L";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// The customer app's ONLY direct table access through this client is
// the pickup_slots availability read in app.js (getPickupSlotTakenCounts()).
// Members, orders and favourites all go through LIFF-verified Edge
// Functions (upsert-member, member-orders, member-favorites, place-order);
// the staff dashboard uses its own signed-in client (staff.js).
