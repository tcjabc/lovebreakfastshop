-- ============================================================
-- 01_schema_check.sql — READ-ONLY. Safe to run any time.
--
-- Every statement here is a SELECT against the catalogs or the app's
-- tables; nothing writes. Run each numbered query on its own in the SQL
-- editor and compare against the ASSUMPTION lines it's tagged with —
-- every `-- ASSUMPTION:` in 02/03/04 points at the check number (C1..C12)
-- that confirms or refutes it. If any check disagrees, stop and fix the
-- later file before running it.
-- ============================================================


-- ------------------------------------------------------------
-- C1. Columns / types / defaults / nullability of every table involved.
-- Confirms (02): orders has id uuid (default gen_random_uuid()),
--   short_id text, items jsonb, total integer, note text, status text,
--   printed boolean, user_id text, is_test boolean, payment_method text,
--   stamp_discount integer, pickup_slot timestamptz, member_name text,
--   stamp_snapshot jsonb, balance_snapshot integer, created_at timestamptz
--   default now().
-- Confirms (04): stored_value_transactions.order_id is text,
--   stamp_redemptions.order_id is uuid.
-- ------------------------------------------------------------
select table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('orders', 'stamp_redemptions', 'stored_value_accounts',
                     'stored_value_transactions', 'pickup_slots',
                     'daily_order_counters', 'feature_flags')
order by table_name, ordinal_position;


-- ------------------------------------------------------------
-- C2. Constraints (PK / unique / check / FK) on those tables.
-- Confirms: stamp_redemptions PK is (user_id, week_start);
--   orders.payment_method check allows exactly 'cash_on_pickup' and
--   'stored_value'; stored_value_transactions.type check includes
--   'deduction'; pickup_slots has a PK/unique on slot and
--   daily_order_counters one on day (both ON CONFLICT targets);
--   whether orders has a UNIQUE on short_id (see 02's tester id note);
--   no existing FKs to orders(id) yet (04 adds them).
-- ------------------------------------------------------------
select c.conrelid::regclass as table_name, c.conname, c.contype,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.connamespace = 'public'::regnamespace
  and c.conrelid in ('public.orders'::regclass, 'public.stamp_redemptions'::regclass,
                     'public.stored_value_accounts'::regclass,
                     'public.stored_value_transactions'::regclass,
                     'public.pickup_slots'::regclass,
                     'public.daily_order_counters'::regclass,
                     'public.feature_flags'::regclass)
order by 1, 2;


-- ------------------------------------------------------------
-- C3. Anything that already references orders (FKs from any table).
-- Expect zero rows before 04 runs.
-- ------------------------------------------------------------
select c.conrelid::regclass as referencing_table, c.conname,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.contype = 'f' and c.confrelid = 'public.orders'::regclass;


-- ------------------------------------------------------------
-- C4. Indexes (incl. unique indexes not expressed as constraints).
-- ------------------------------------------------------------
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('orders', 'stamp_redemptions', 'stored_value_accounts',
                    'stored_value_transactions', 'pickup_slots',
                    'daily_order_counters', 'feature_flags')
order by tablename, indexname;


-- ------------------------------------------------------------
-- C5. Triggers on those tables (a trigger on orders could change what
-- place_order()'s insert actually does). Expect zero user triggers.
-- ------------------------------------------------------------
select tgrelid::regclass as table_name, tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where not t.tgisinternal
  and tgrelid in ('public.orders'::regclass, 'public.stamp_redemptions'::regclass,
                  'public.stored_value_accounts'::regclass,
                  'public.stored_value_transactions'::regclass,
                  'public.pickup_slots'::regclass,
                  'public.daily_order_counters'::regclass);


-- ------------------------------------------------------------
-- C6. Table owners, RLS on/forced, and whether the owner bypasses RLS.
-- Confirms (02): tables are owned by the same role that will own
--   place_order() (the SQL editor runs as `postgres`), and none has
--   FORCE ROW LEVEL SECURITY — so the security-definer function isn't
--   blocked by the zero-policy tables (stamp_redemptions, stored_value_*).
-- ------------------------------------------------------------
select c.oid::regclass as table_name, pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
       r.rolbypassrls as owner_bypasses_rls
from pg_class c
join pg_roles r on r.oid = c.relowner
where c.oid in ('public.orders'::regclass, 'public.stamp_redemptions'::regclass,
                'public.stored_value_accounts'::regclass,
                'public.stored_value_transactions'::regclass,
                'public.pickup_slots'::regclass,
                'public.daily_order_counters'::regclass,
                'public.feature_flags'::regclass);

-- The role this SQL editor session runs as (will own anything 02/03 create):
select current_user, session_user;


-- ------------------------------------------------------------
-- C7. RLS policies currently on those tables (context for cutover).
-- ------------------------------------------------------------
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('orders', 'stamp_redemptions', 'stored_value_accounts',
                    'stored_value_transactions', 'pickup_slots',
                    'daily_order_counters', 'feature_flags')
order by tablename, policyname;


-- ------------------------------------------------------------
-- C8. Function signatures, return types, security, search_path, owner.
-- Confirms: reserve_pickup_slot(timestamptz, integer) returns integer
--   with no proconfig (no search_path); next_daily_order_number()
--   returns integer with search_path=public; spend_stored_value /
--   topup_stored_value signatures match README; place_order doesn't
--   exist yet (or, after 02, has search_path=public and secdef=true).
-- ------------------------------------------------------------
select p.oid::regprocedure            as function,
       pg_get_function_result(p.oid)  as returns,
       l.lanname                      as language,
       p.prosecdef                    as security_definer,
       p.proconfig                    as config,
       pg_get_userbyid(p.proowner)    as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public'
  and p.proname in ('reserve_pickup_slot', 'next_daily_order_number',
                    'spend_stored_value', 'topup_stored_value', 'place_order')
order by p.proname;


-- ------------------------------------------------------------
-- C9. Current full definitions of spend_stored_value() and
-- topup_stored_value() — compare with README.md ("Stored Value"). 02
-- inlines spend_stored_value()'s logic; 04 changes the column it
-- writes order_id into.
-- ------------------------------------------------------------
select p.oid::regprocedure as function, pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('spend_stored_value', 'topup_stored_value');


-- ------------------------------------------------------------
-- C10. Who can EXECUTE each function. A NULL proacl means the default,
-- i.e. EXECUTE granted to PUBLIC (so anon/authenticated can call it).
-- Confirms: reserve_pickup_slot / next_daily_order_number are
--   anon-callable today; spend/topup are not (README revoked them);
--   after 02, place_order is callable by service_role only.
-- ------------------------------------------------------------
select p.oid::regprocedure as function,
       p.proacl            as raw_acl,
       has_function_privilege('anon',          p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role',  p.oid, 'execute') as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('reserve_pickup_slot', 'next_daily_order_number',
                    'spend_stored_value', 'topup_stored_value', 'place_order')
order by p.proname;


-- ------------------------------------------------------------
-- C11. Taipei date math sanity: the fixed +8h shift (what
-- _shared/taipeiWeek.ts does, and what 02 uses) must agree with the
-- tz-database conversion (what next_daily_order_number() uses), and
-- week_start must be the Monday on or before today.
-- Expect: both dates equal; isodow of week_start = 1.
-- ------------------------------------------------------------
select now()                                                        as now_utc,
       ((now() at time zone 'UTC') + interval '8 hours')::date      as taipei_today_fixed_offset,
       (now() at time zone 'Asia/Taipei')::date                     as taipei_today_tzdb,
       extract(isodow from ((now() at time zone 'UTC') + interval '8 hours')::date) as taipei_isodow,
       ((now() at time zone 'UTC') + interval '8 hours')::date
         - (extract(isodow from ((now() at time zone 'UTC') + interval '8 hours')::date)::int - 1)
                                                                    as week_start_monday;


-- ------------------------------------------------------------
-- C12. Data checks for 04: stored_value_transactions.order_id values
-- that aren't valid uuids (the text -> uuid conversion would fail on
-- them), and how many rows have an order_id at all.
-- ------------------------------------------------------------
select count(*) filter (where order_id is not null)                         as rows_with_order_id,
       count(*) filter (where order_id is not null
                          and order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
                                                                            as non_uuid_order_ids
from public.stored_value_transactions;
