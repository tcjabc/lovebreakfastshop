# supabase/sql

Hand-run SQL for the Supabase project, kept in version control. Nothing
here runs automatically: every file is pasted into the Supabase SQL
editor by hand. This folder is excluded from the public site by
`.assetsignore` (the whole `supabase/` directory is).

It exists for the move to a single server-side order path: a
`place-order` Edge Function (service role) validates and prices the
order, then calls **one** Postgres function, `place_order()`, that does
every write in one transaction.

## Files

| File | What it is | When to run |
|---|---|---|
| `00_existing_functions.sql` | Verbatim copies of `next_daily_order_number()` and `reserve_pickup_slot()` as they exist live (captured 2026-09-27). Reference only. | **Don't run.** It's the source of record for two functions created directly in the SQL editor. |
| `01_schema_check.sql` | Read-only catalog and data checks (C1–C12). Every `-- ASSUMPTION:` in 02–04 names the check that confirms it. | **Now, first.** Safe any time. |
| `02_place_order.sql` | Creates `public.place_order(...)`: security definer, `search_path = public`, EXECUTE for `service_role` only. It includes a commented-out BEGIN…ROLLBACK smoke test. | **Now**, after 01 checks out. Nothing calls it yet. |
| `03_harden_existing.sql` | **Part A:** re-creates `reserve_pickup_slot()` with `SET search_path = public`; the body is unchanged and grants are kept. **Part B (commented out):** revokes anon EXECUTE on `reserve_pickup_slot` / `next_daily_order_number`. | **Part A now.** **Part B at cutover only.** |
| `04_foreign_keys.sql` | **Part A:** read-only orphan report. **Part B:** commented-out options for cleaning up orphans. **Part C (commented out):** `stored_value_transactions.order_id` text → uuid, FKs from both tables to `orders(id)`, and dropping `spend_stored_value()`. | **Part A now.** **Part C at cutover only**, after orphans are handled. |
| `05_staff_policies.sql` | Lockdown L1: `authenticated` SELECT+UPDATE on `orders` and SELECT on `members`, for the staff dashboard's Supabase Auth login. Added alongside the existing policies, so nothing changes until those are dropped. Starts and ends with read-only policy listings. | **Now.** Needs "Allow anonymous sign-ins" OFF (see file header). |

## Run order

**Now (the live app keeps working unchanged):**

1. `01_schema_check.sql`: run each query and check it against the ASSUMPTION lines.
2. `03_harden_existing.sql` Part A.
3. `02_place_order.sql`. Optionally run its smoke test; the whole block rolls back.
4. `04_foreign_keys.sql` Part A: review any orphans.

**At cutover:** once `place-order` is deployed, `app.js` uses it, and a real order has gone through it end to end:

5. Deploy the new `app.js`, remove the `spend-stored-value` and `redeem-stamp-drink` Edge Functions, and give cached old clients time to expire.
6. `04_foreign_keys.sql` Part B as needed, then Part C. Part C refuses to run while orphans remain.
7. `03_harden_existing.sql` Part B (revoke anon EXECUTE).
8. The RLS changes that remove anon access to `orders`. Those aren't in this folder yet.

**Why 04 Part C and 03 Part B can't run early:**
- The current app calls `reserve_pickup_slot` and `next_daily_order_number` directly, so revoking anon EXECUTE on them breaks checkout.
- The current app also writes `stamp_redemptions` and `stored_value_transactions` rows *before* the order exists, so the new FKs would reject those rows.

## `place_order()` error codes

Every error is raised with a custom SQLSTATE, and the message is the code itself. Map on `error.code`:

| SQLSTATE | message | Meaning |
|---|---|---|
| `LB001` | `slot_full` | The slot already has `p_slot_cap` orders |
| `LB002` | `already_redeemed` | This member already redeemed this Taipei week |
| `LB003` | `insufficient_funds` | No stored-value account, or the balance is less than `p_total` |
| `LB004` | `not_friday` | Stamp redemption attempted on a day that isn't Friday in Taipei |
| `LB005` | `order_number_failed` | `next_daily_order_number()` returned NULL |
| `LB010` | `invalid_input` | Bad or inconsistent parameters; `detail` says which |

Any error rolls back everything, including the slot reservation and the daily-number bump.

`place_order()` returns a single row `{id, short_id, balance_after}`. Through supabase-js `rpc()`, that arrives as a one-element array.
