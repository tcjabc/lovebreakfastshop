-- ============================================================
-- 00_existing_functions.sql — REFERENCE ONLY, do not re-run.
--
-- Version-controlled copy of two functions that were created directly
-- in the Supabase SQL editor and were never checked in before.
-- Captured verbatim from the SQL editor on 2026-09-27 (pg_get_functiondef
-- output). They already exist live; re-running this file would be a
-- no-op at best — it's here so the repo has the source.
--
--   next_daily_order_number() — already has SET search_path TO 'public'.
--   reserve_pickup_slot()     — does NOT; fixed by 03_harden_existing.sql.
--
-- Both are SECURITY DEFINER and currently executable by anon (the live
-- app calls both directly via supabase.rpc()). Revoking that is the
-- CUTOVER step in 03 — see README.md in this folder.
--
-- reserve_pickup_slot() returns NULL when the slot is full: the
-- conditional DO UPDATE (... where taken < p_max) affects no row, so
-- RETURNING yields nothing. Note the INSERT path (no row for that slot
-- yet) always succeeds with taken = 1 regardless of p_max.
--
-- To re-capture later (read-only):
--   select p.oid::regprocedure, pg_get_functiondef(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('next_daily_order_number', 'reserve_pickup_slot');
-- ============================================================

CREATE OR REPLACE FUNCTION public.next_daily_order_number()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.daily_order_counters (day, count)
  values ((now() at time zone 'Asia/Taipei')::date, 1)
  on conflict (day) do update set count = daily_order_counters.count + 1
  returning count;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_pickup_slot(p_slot timestamp with time zone, p_max integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
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
