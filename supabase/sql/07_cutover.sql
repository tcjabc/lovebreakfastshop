-- ============================================================
-- 07_cutover.sql — Lockdown L4: remove all direct anon access.
--
-- Drafted from the REAL policy/grant names returned by the read-only
-- probe in supabase/sql/README.md's "L4 pre-cutover check" (run
-- 2026-09-29). Do not re-derive names from any other file — table/
-- function definitions elsewhere in supabase/sql/ may describe intent,
-- this file matches what is actually live.
--
-- PRECONDITIONS (all confirmed before drafting this):
--   1. app.js / supabase-config.js touch the anon client for exactly
--      one thing: pickup_slots SELECT (getPickupSlotTakenCounts() in
--      app.js). print.js makes no Supabase calls. staff/staff.js uses
--      ONLY the signed-in staffClient (orders SELECT/UPDATE, members
--      SELECT) — never the anon client.
--   2. feature_flags is read server-side only, by place-order (service
--      role) — no client code reads it.
--   3. Nothing calls spend-stored-value or redeem-stamp-drink anymore.
--   4. App is not live (test data only) — safe to cut over without a
--      maintenance window.
--
-- RUN ORDER: top to bottom, in ONE editor run per lettered step (a
-- transaction per step is fine; f is already its own transaction).
-- Re-run the read-only queries under "STEP H — VERIFICATION" afterward.
-- ============================================================


-- ---------------- STEP A — orders: drop the "allow all" policy ----------------
-- Keeps "staff can read orders" (SELECT, authenticated) and
-- "staff can update orders" (UPDATE, authenticated) — both untouched.
-- After this, anon has ZERO policies on orders (default-deny); the only
-- writer is place_order(), a security-definer function owned by
-- postgres, called only via the place-order Edge Function's
-- service-role client — service_role bypasses RLS entirely, so this
-- doesn't touch place_order()'s ability to write.
drop policy if exists "allow all" on public.orders;


-- ---------------- STEP B — members, favorites: drop anon/public policies ----------------
-- members: drop "allow all"; keep "staff can read members" (SELECT,
-- authenticated) — staff never writes members, so authenticated has no
-- write access either, matching upsert-member (service role) being the
-- only writer.
drop policy if exists "allow all" on public.members;

-- favorites: drop "Allow all" (note the capital A — this is the real
-- name from the probe). No staff-role policy exists for favorites (the
-- staff dashboard never touches it) — after this, favorites has RLS
-- enabled with ZERO policies at all, i.e. default-deny for anon AND
-- authenticated alike. Only member-favorites (service role) can touch
-- it. This is intentional: same zero-policy pattern already used for
-- stored_value_accounts / stored_value_transactions / stamp_redemptions.
drop policy if exists "Allow all" on public.favorites;


-- ---------------- STEP C — feature_flags: drop the anon read policy ----------------
-- Confirmed (precondition 2): nothing in the browser reads feature_flags
-- — only place-order, via the service-role client, which bypasses RLS
-- regardless of policies. Dropping this has zero effect on place-order.
drop policy if exists "anyone can read flags" on public.feature_flags;


-- ---------------- STEP D — pickup_slots: confirm-only, no change ----------------
-- The probe shows exactly one policy on pickup_slots: "Allow read"
-- (SELECT, public) — no anon INSERT/UPDATE/DELETE policy exists today.
-- Nothing to drop here; "Allow read" stays so the slot picker's
-- availability display keeps working. (Slot RESERVATION already goes
-- through reserve_pickup_slot(), a security-definer function — see
-- STEP E — not through a direct table write.)


-- ---------------- STEP E — revoke EXECUTE on the two remaining anon-callable functions ----------------
-- Identical to 03_harden_existing.sql's Part B (drafted at lockdown L1,
-- held until now) — reproduced here so this file is a self-contained
-- cutover script. next_daily_order_number() currently has execute
-- granted to PUBLIC itself (not just anon/authenticated), per the
-- probe — this revokes all three.
revoke execute on function public.reserve_pickup_slot(timestamp with time zone, integer) from public, anon, authenticated;
revoke execute on function public.next_daily_order_number() from public, anon, authenticated;

-- Why place_order() keeps working after this (verified, not assumed):
--   1. The probe shows place_order(...) already has EXECUTE granted
--      ONLY to postgres and service_role — never to anon/authenticated/
--      PUBLIC. That was set by 02_place_order.sql's own revoke/grant at
--      creation time; this step doesn't touch place_order()'s grants at
--      all, so the place-order Edge Function (service-role client)
--      calling it is completely unaffected.
--   2. Inside place_order(), the calls to
--      public.reserve_pickup_slot(...) and
--      public.next_daily_order_number() are NESTED calls made from
--      within place_order()'s own SECURITY DEFINER execution context.
--      Postgres evaluates a nested call's EXECUTE privilege against the
--      CURRENT role at that point in execution — inside a SECURITY
--      DEFINER function, that's the function's OWNER, not the original
--      caller. place_order() is owned by postgres (it was created via
--      the SQL editor, which runs as postgres), and the probe shows
--      postgres already holds an explicit EXECUTE grant on both
--      reserve_pickup_slot() and next_daily_order_number() — a grant
--      this REVOKE (from public/anon/authenticated only) does not
--      touch. So the nested calls keep working even though the ORIGINAL
--      caller (anon, if they tried to call reserve_pickup_slot directly)
--      can no longer call these functions themselves.
--   3. This can be re-confirmed after running this step with the
--      STEP H verification query (function_grant rows for both
--      functions should show only postgres + service_role remaining).


-- ---------------- STEP F — 04_foreign_keys.sql Part C: re-check orphans, then migrate ----------------
-- Re-running Part A's orphan report first (its own file says "safe to
-- run now, and again right before PART C") — do not skip this even
-- though app is not live; it costs nothing and this is the actual
-- precondition check for the migration below.

-- F1 (= 04's A1). Stamp redemptions whose order never got created.
-- Expect zero rows.
select sr.user_id, sr.week_start, sr.order_id, sr.redeemed_at
from public.stamp_redemptions sr
left join public.orders o on o.id = sr.order_id
where o.id is null
order by sr.redeemed_at;

-- F2 (= 04's A2). Stored-value ledger rows pointing at a missing order.
-- Expect zero rows. If this returns rows, STOP — see 04_foreign_keys.sql
-- PART B for how to handle them (never just delete these).
select t.id, t.user_id, t.amount, t.type, t.order_id, t.staff_note, t.created_at
from public.stored_value_transactions t
left join public.orders o on o.id::text = lower(t.order_id)
where t.order_id is not null
  and o.id is null
order by t.created_at;

-- F3 (= 04's A3). order_id values that aren't valid uuids at all (the
-- type conversion below would fail on these). Expect zero rows.
select t.id, t.order_id
from public.stored_value_transactions t
where t.order_id is not null
  and t.order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- If F1/F2/F3 all returned zero rows, run the migration below as one
-- transaction. The DO block re-checks all three conditions inside the
-- transaction (belt-and-suspenders against a race between the checks
-- above and this running) and aborts if any orphan slipped in.
--
-- place_order()'s own insert already works with order_id as uuid: its
-- INSERT INTO stored_value_transactions (..., order_id) VALUES
-- (..., v_order_id) uses v_order_id, which is declared `uuid` (see
-- 02_place_order.sql's declare block) — assigning uuid into a uuid
-- column needs no cast at all, so this migration only makes that
-- assignment more direct, never breaks it. (Contrast with
-- spend_stored_value()'s p_order_id, a `text` parameter — that one
-- can no longer insert into the now-uuid column, which is exactly why
-- it's dropped in this same transaction, below.)

begin;

do $$
begin
  if exists (select 1 from public.stamp_redemptions sr
             where not exists (select 1 from public.orders o where o.id = sr.order_id)) then
    raise exception 'orphaned stamp_redemptions rows remain — see F1 above';
  end if;
  if exists (select 1 from public.stored_value_transactions t
             where t.order_id is not null
               and t.order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'non-uuid stored_value_transactions.order_id values remain — see F3 above';
  end if;
  if exists (select 1 from public.stored_value_transactions t
             where t.order_id is not null
               and not exists (select 1 from public.orders o where o.id::text = lower(t.order_id))) then
    raise exception 'orphaned stored_value_transactions rows remain — see F2 above';
  end if;
end $$;

alter table public.stored_value_transactions
  alter column order_id type uuid using order_id::uuid;

alter table public.stored_value_transactions
  add constraint stored_value_transactions_order_id_fkey
  foreign key (order_id) references public.orders (id) on delete restrict;

alter table public.stamp_redemptions
  add constraint stamp_redemptions_order_id_fkey
  foreign key (order_id) references public.orders (id) on delete restrict;

-- FK columns aren't indexed automatically; these keep "delete an
-- order" / "which rows reference this order" lookups cheap.
create index if not exists stored_value_transactions_order_id_idx
  on public.stored_value_transactions (order_id);
create index if not exists stamp_redemptions_order_id_idx
  on public.stamp_redemptions (order_id);

-- ---------------- STEP G — drop spend_stored_value() ----------------
-- Only the retired spend-stored-value Edge Function called this (see
-- precondition 3, and delete that function's folder in the same
-- change — supabase/functions/spend-stored-value/). place_order()
-- inlines the same balance-deduction logic itself. topup_stored_value()
-- is untouched — topup-stored-value (staff top-up panel) still uses it,
-- and it never writes order_id.
drop function if exists public.spend_stored_value(text, integer, text);

commit;

-- Note: with ON DELETE RESTRICT, deleting an order (e.g. cleaning up
-- test orders) now fails if a stamp redemption or stored-value row
-- references it — delete/detach those first, deliberately.


-- ============================================================
-- STEP H — VERIFICATION (read-only). Run after all of the above.
-- ============================================================

-- H1. Final policies on the tables this step touched — expect:
--   orders:    staff can read orders (SELECT, authenticated),
--              staff can update orders (UPDATE, authenticated) — 2 rows
--   members:   staff can read members (SELECT, authenticated) — 1 row
--   favorites: 0 rows
--   feature_flags: 0 rows
--   pickup_slots: Allow read (SELECT, public) — 1 row, unchanged
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('orders', 'members', 'favorites', 'feature_flags', 'pickup_slots')
order by tablename, policyname;

-- H2. Final EXECUTE grants on the functions this step touched — expect:
--   reserve_pickup_slot / next_daily_order_number: postgres,
--     service_role only (no PUBLIC/anon/authenticated rows)
--   place_order: unchanged — postgres, service_role only
--   spend_stored_value: 0 rows (function no longer exists)
select p.oid::regprocedure as function,
       case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
       a.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
where n.nspname = 'public'
  and p.proname in ('reserve_pickup_slot', 'next_daily_order_number', 'place_order', 'spend_stored_value')
order by function, grantee;

-- H3. stored_value_transactions.order_id is now uuid, with both FKs and
-- indexes in place.
select column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'stored_value_transactions' and column_name = 'order_id';

select conname, conrelid::regclass, confrelid::regclass, pg_get_constraintdef(oid)
from pg_constraint
where contype = 'f' and confrelid = 'public.orders'::regclass;


-- ============================================================
-- ROLLBACK — commented out. Restores today's ACCESS (steps A, B, C, E)
-- exactly as it was before this file ran. Deliberately does NOT reverse
-- F/G (the FK/column-type migration and dropping spend_stored_value) —
-- those are structural changes, safe to leave in place even if you
-- revert the access posture; unwinding them is a separate, deliberate
-- decision (see the second block below if you genuinely need that too).
-- ============================================================

-- ---- Rollback: RLS policies + function grants (A, B, C, E) ----
-- begin;
--
-- create policy "allow all" on public.orders for all using (true) with check (true);
-- create policy "allow all" on public.members for all using (true) with check (true);
-- create policy "Allow all" on public.favorites for all using (true) with check (true);
-- create policy "anyone can read flags" on public.feature_flags for select using (true);
--
-- grant execute on function public.reserve_pickup_slot(timestamp with time zone, integer) to public, anon, authenticated;
-- grant execute on function public.next_daily_order_number() to public, anon, authenticated;
--
-- commit;

-- ---- Additionally, to fully undo F + G too (rarely needed — only if
-- -- abandoning place_order()'s idempotent design and reverting to the old
-- -- client-side checkout sequence): ----
-- begin;
--
-- alter table public.stored_value_transactions drop constraint if exists stored_value_transactions_order_id_fkey;
-- alter table public.stamp_redemptions drop constraint if exists stamp_redemptions_order_id_fkey;
-- drop index if exists public.stored_value_transactions_order_id_idx;
-- drop index if exists public.stamp_redemptions_order_id_idx;
-- alter table public.stored_value_transactions alter column order_id type text using order_id::text;
--
-- create or replace function public.spend_stored_value(p_user_id text, p_amount int, p_order_id text)
-- returns int
-- language plpgsql
-- security definer
-- as $$
-- declare v_new_balance int;
-- begin
--   update stored_value_accounts
--     set balance = balance - p_amount, updated_at = now()
--     where user_id = p_user_id and balance >= p_amount
--     returning balance into v_new_balance;
--   if v_new_balance is null then
--     raise exception 'insufficient_funds';
--   end if;
--   insert into stored_value_transactions (user_id, amount, type, order_id)
--     values (p_user_id, -p_amount, 'deduction', p_order_id);
--   return v_new_balance;
-- end;
-- $$;
-- revoke execute on function public.spend_stored_value from public, anon, authenticated;
-- grant execute on function public.spend_stored_value to service_role;
--
-- commit;
