-- ============================================================
-- 05_staff_policies.sql — Lockdown step L1: staff dashboard login.
--
-- The staff dashboard (staff/staff.js) now signs in as the single
-- Supabase Auth staff user, so its requests use the `authenticated`
-- role. These policies give that role exactly what the dashboard needs:
--   orders  — SELECT (order queue) + UPDATE (status, printed)
--   members — SELECT (會員儲值 top-up member search)
--
-- ADDED ALONGSIDE the existing policies. Permissive policies are OR'd
-- together, so while the old "allow all" policies still exist nothing
-- changes for anyone; these only start to matter once those are dropped
-- at cutover. Safe to run now.
--
-- Always add the orders SELECT and UPDATE policies TOGETHER. SELECT
-- without UPDATE means the dashboard sees unprinted orders but can't
-- mark them printed (staff.js now halts auto-print instead of looping,
-- but it's still broken).
--
-- `to authenticated` = ANY signed-in Supabase Auth user. That's only
-- safe because the staff user is the only one:
--   * public sign-ups are disabled (done in the dashboard), and
--   * "Allow anonymous sign-ins" must be OFF (Authentication → Sign In /
--     Providers). An anonymous sign-in also gets the authenticated role
--     and would otherwise pass these policies.
-- The optional block at the bottom ties the policies to the staff user
-- specifically instead.
--
-- Not re-runnable as-is: CREATE POLICY fails if the name already exists.
-- ============================================================


-- ---- Step 1 (read-only): current policies — paste the result back ----
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('orders', 'members', 'pickup_slots', 'feature_flags')
order by tablename, policyname;


-- ---- Step 2: add the staff policies ----

create policy "staff can read orders"
  on public.orders
  for select
  to authenticated
  using (true);

create policy "staff can update orders"
  on public.orders
  for update
  to authenticated
  using (true)
  with check (true);

create policy "staff can read members"
  on public.members
  for select
  to authenticated
  using (true);


-- ---- Step 3 (read-only): confirm they're there ----
select tablename, policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('orders', 'members')
  and 'authenticated' = any (roles)
order by tablename, policyname;


-- ============================================================
-- OPTIONAL HARDENING — commented out. Instead of "any authenticated
-- user", only a user whose app_metadata says role = staff. app_metadata
-- can only be set server-side (dashboard / service role / SQL), never
-- by the user, so this also shuts out anonymous sign-ins or an account
-- created by mistake. To use it: tag the staff user, then replace
-- `using (true)` / `with check (true)` above with the expression below.
--
-- update auth.users
--    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"staff"}'::jsonb
--  where email = '<STAFF_EMAIL>';
--
--   using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'staff')
--   with check ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'staff')
--
-- (The staff device has to sign in again after tagging, so its token
-- carries the new claim.)
-- ============================================================
