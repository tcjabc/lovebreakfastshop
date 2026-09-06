// ============================================================
// corsHeaders — shared CORS response headers for every Stored Value
// Edge Function called directly from browser JS (staff.js today;
// app.js once checkout is wired up in a later pass).
//
// Supabase Edge Functions do NOT add CORS headers by default, unlike
// the PostgREST /rest/v1 API — without these, the browser's preflight
// OPTIONS request fails before the function's own POST logic (PIN or
// LIFF-token verification) ever runs at all.
//
// `*` is fine here: every function using this still requires the
// anon/publishable key as a bearer token (platform-level, via
// Supabase's own JWT check) plus its own PIN or LIFF-token check
// (application-level) — CORS is not standing in as the security
// boundary for any of them, it's just what lets the browser make the
// request in the first place.
// ============================================================

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
