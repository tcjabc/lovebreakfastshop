-- ============================================================
-- 04_foreign_keys.sql
--
-- PART A — READ-ONLY orphan report. Safe to run now, and again right
--   before PART C.
-- PART B — commented-out options for dealing with orphans. Only after
--   you've reviewed PART A's output; choose per row.
-- PART C — the migration: stored_value_transactions.order_id text → uuid,
--   plus FKs from stored_value_transactions and stamp_redemptions to
--   orders(id). CUTOVER ONLY — commented out.
--
-- !!! PART C MUST NOT RUN WHILE THE CURRENT APP IS LIVE, even with zero
-- orphans. Today's checkout (app.js submitOrder()) calls
-- redeem-stamp-drink and spend-stored-value BEFORE inserting the order,
-- so both write rows whose order_id doesn't exist yet — with these FKs
-- in place those writes fail and stamp / stored-value checkout breaks.
-- Also, spend_stored_value() inserts its TEXT p_order_id into order_id;
-- once the column is uuid that insert fails (text → uuid is not an
-- assignment cast). PART C is only safe once place-order (02) is the
-- only writer — see README.md in this folder.
--
-- ASSUMPTION (C1): stored_value_transactions.order_id is text and
--   stamp_redemptions.order_id is uuid.
-- ASSUMPTION (C3): no FKs reference orders yet.
-- ASSUMPTION (C12): every non-null stored_value_transactions.order_id
--   is a valid uuid string (the conversion would fail otherwise).
-- ============================================================


-- ---------------- PART A: orphan report (read-only) ----------------

-- A1. Stamp redemptions whose order never got created. Known cause: the
-- redemption succeeded, then spend-stored-value or insertOrder failed.
-- For the CURRENT week these are members who lost this week's free
-- drink without getting it.
select sr.user_id, sr.week_start, sr.order_id, sr.redeemed_at
from public.stamp_redemptions sr
left join public.orders o on o.id = sr.order_id
where o.id is null
order by sr.redeemed_at;

-- A2. Stored-value ledger rows pointing at a missing order. Known cause:
-- spend succeeded, then insertOrder failed — money was deducted with no
-- order (the customer saw 「訂單儲存失敗，但儲值已扣款」). These need a
-- human decision (refund?), not just a delete.
select t.id, t.user_id, t.amount, t.type, t.order_id, t.staff_note, t.created_at
from public.stored_value_transactions t
left join public.orders o on o.id::text = lower(t.order_id)
where t.order_id is not null
  and o.id is null
order by t.created_at;

-- A3. order_id values that aren't valid uuids at all (PART C's type
-- conversion would fail on these). Expect zero rows.
select t.id, t.order_id
from public.stored_value_transactions t
where t.order_id is not null
  and t.order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';


-- ---------------- PART B: dealing with orphans (choose per row) ----------------
--
-- Stamp redemptions (A1):
--   * Deleting a row gives that member their redemption back for that
--     week. For past weeks it's harmless (they can't redeem a past week
--     anyway); for the current week it lets them redeem again.
-- delete from public.stamp_redemptions sr
--  where not exists (select 1 from public.orders o where o.id = sr.order_id);
--
-- Stored-value deductions (A2): DON'T delete them — the balance was
-- already reduced, and deleting the ledger row would hide that. Either:
--   (a) refund via the normal top-up path (staff panel, which records a
--       'topup' row), then detach the orphan row from the missing order
--       while keeping the old id for the record:
-- update public.stored_value_transactions t
--    set staff_note = coalesce(t.staff_note || ' ', '') || '[orphaned order_id ' || t.order_id || ']',
--        order_id   = null
--  where t.order_id is not null
--    and not exists (select 1 from public.orders o where o.id::text = lower(t.order_id));
--   (b) or, if staff DID hand the food over, create the missing order
--       row by hand first so the reference becomes valid.


-- ---------------- PART C: CUTOVER — DO NOT RUN YET ----------------
--
-- Preconditions (all of them):
--   1. place-order (02) is live and app.js no longer calls
--      spend-stored-value / redeem-stamp-drink / insertOrder;
--   2. those two Edge Functions are undeployed (or at least no longer
--      reachable) — otherwise a stale cached app.js can still call them;
--   3. PART A returns zero rows for A1, A2 and A3.
-- The DO block re-checks (3) inside the transaction and aborts if not.
--
-- begin;
--
-- do $$
-- begin
--   if exists (select 1 from public.stamp_redemptions sr
--              where not exists (select 1 from public.orders o where o.id = sr.order_id)) then
--     raise exception 'orphaned stamp_redemptions rows remain — see PART A (A1)';
--   end if;
--   if exists (select 1 from public.stored_value_transactions t
--              where t.order_id is not null
--                and t.order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
--     raise exception 'non-uuid stored_value_transactions.order_id values remain — see PART A (A3)';
--   end if;
--   if exists (select 1 from public.stored_value_transactions t
--              where t.order_id is not null
--                and not exists (select 1 from public.orders o where o.id::text = lower(t.order_id))) then
--     raise exception 'orphaned stored_value_transactions rows remain — see PART A (A2)';
--   end if;
-- end $$;
--
-- alter table public.stored_value_transactions
--   alter column order_id type uuid using order_id::uuid;
--
-- alter table public.stored_value_transactions
--   add constraint stored_value_transactions_order_id_fkey
--   foreign key (order_id) references public.orders (id) on delete restrict;
--
-- alter table public.stamp_redemptions
--   add constraint stamp_redemptions_order_id_fkey
--   foreign key (order_id) references public.orders (id) on delete restrict;
--
-- -- FK columns aren't indexed automatically; these keep "delete an
-- -- order" / "which rows reference this order" lookups cheap.
-- create index if not exists stored_value_transactions_order_id_idx
--   on public.stored_value_transactions (order_id);
-- create index if not exists stamp_redemptions_order_id_idx
--   on public.stamp_redemptions (order_id);
--
-- -- spend_stored_value(text, int, text) can no longer insert its text
-- -- p_order_id into a uuid column. Its only caller is the retired
-- -- spend-stored-value Edge Function, so drop it (place_order inlines
-- -- the same logic). topup_stored_value doesn't write order_id and is
-- -- unaffected.
-- drop function if exists public.spend_stored_value(text, integer, text);
--
-- commit;
--
-- Note: with ON DELETE RESTRICT, deleting an order (e.g. cleaning up
-- test orders) now fails if a stamp redemption or stored-value row
-- references it — delete/detach those first, deliberately.
