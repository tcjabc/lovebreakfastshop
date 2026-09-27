-- ============================================================
-- 03_harden_existing.sql
--
-- PART A — SAFE TO RUN NOW. Re-creates reserve_pickup_slot() with
-- `SET search_path = public`. The body is copied verbatim from
-- 00_existing_functions.sql (captured 2026-09-27); the ONLY change is
-- the added SET clause, so behaviour is identical.
--
-- Why: it's SECURITY DEFINER with no search_path, and its body refers
-- to `pickup_slots` unqualified — a caller who could put an object
-- named pickup_slots earlier on their search_path could redirect what
-- the function (running as its owner) writes to. Pinning search_path
-- closes that. next_daily_order_number() already has
-- SET search_path TO 'public', so it needs no change.
--
-- CREATE OR REPLACE keeps the function's existing owner and EXECUTE
-- grants (the live app's anon calls keep working), and the signature
-- is unchanged, so place_order() (02) and supabase.rpc() callers are
-- unaffected.
--
-- ASSUMPTION (C8): the live reserve_pickup_slot is still exactly the
--   2026-09-27 definition in 00 (re-check C8/00's capture query if
--   anything was edited since).
-- ASSUMPTION (C10): anon/authenticated currently have EXECUTE on it —
--   and still will after this (CREATE OR REPLACE preserves grants).
--
-- PART B — CUTOVER ONLY, commented out. See README.md in this folder.
-- ============================================================

-- ---------------- PART A: run now ----------------

CREATE OR REPLACE FUNCTION public.reserve_pickup_slot(p_slot timestamp with time zone, p_max integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
declare
  new_taken integer;
begin
  insert into pickup_slots (slot, taken)
  values (p_slot, 1)
  on conflict (slot) do update
    set taken = pickup_slots.taken + 1
    where pickup_slots.taken < p_max
  returning taken into new_taken;

  return new_taken;
end;
$function$;

-- Verify (read-only): config should now show {search_path=public}, and
-- anon should still be true until cutover.
-- select p.oid::regprocedure, p.proconfig,
--        has_function_privilege('anon', p.oid, 'execute') as anon
-- from pg_proc p where p.proname in ('reserve_pickup_slot', 'next_daily_order_number');


-- ---------------- PART B: CUTOVER — DO NOT RUN YET ----------------
--
-- Only after ALL of these are true:
--   * the place-order Edge Function is deployed and app.js calls it
--     instead of reserve_pickup_slot / next_daily_order_number /
--     insertOrder / spend-stored-value / redeem-stamp-drink;
--   * that app.js is deployed and old cached copies have had time to
--     expire (the live app calls both functions directly via
--     supabase.rpc() today — revoking early breaks checkout);
--   * a real test order has gone through place-order end to end.
--
-- After this, only service_role (and the owner, which is who
-- place_order() runs as) can call them. getPickupSlotTakenCounts() in
-- app.js reads the pickup_slots TABLE, not these functions, so the slot
-- picker's availability display is unaffected by this part.
--
-- revoke execute on function public.reserve_pickup_slot(timestamptz, integer) from public, anon, authenticated;
-- revoke execute on function public.next_daily_order_number() from public, anon, authenticated;
-- grant  execute on function public.reserve_pickup_slot(timestamptz, integer) to service_role;
-- grant  execute on function public.next_daily_order_number() to service_role;
