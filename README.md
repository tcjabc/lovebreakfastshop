# Breakfast Shop Ordering App — Setup Guide

This app opens inside LINE (via the Official Account) and lets customers
build an order, then sends it straight into the shop's LINE chat as a
message. No backend, no database, no monthly cost beyond an optional
custom domain.

## What you'll need (all free)

- Your wife's LINE Official Account (already exists)
- A LINE Developers account (any personal LINE account can create one)
- A place to host 4 static files — Netlify, Vercel, Cloudflare Pages, or
  GitHub Pages all have free tiers that comfortably cover this

## Step 1 — Edit the menu

Open `menu.js` and edit the `MENU` array: category names, item names,
and prices. All user-facing text in this app is Chinese-only (see
CLAUDE.md) — leave `nameEn` blank (`""`) as the other items do; it's
still there as a field, just unused by design now. No other file
needs to change for a menu update. Also update `SHOP_INFO.name` to
the real shop name.

## Step 2 — Host the files

Easiest option: **Netlify**
1. Go to netlify.com, sign up free
2. Drag the whole `breakfast-order-app` folder onto the Netlify dashboard
3. It gives you a URL like `https://yourshop-order.netlify.app`

(Vercel and Cloudflare Pages work the same way if you prefer those.)

## Step 3 — Create a LINE Login channel + LIFF app

1. Go to https://developers.line.biz/console/ and log in
2. Select the same provider your wife's Official Account uses (or create
   one)
3. Create a new channel → **LINE Login** channel
4. Inside that channel, go to the **LIFF** tab → **Add**
   - App name: e.g. "樂福 Order"
   - Size: **Full**
   - Endpoint URL: the Netlify URL from Step 2
   - Scopes: check `chat_message.write` (needed for sendMessages)
   - Bot link feature: **On**, linked to your wife's Official Account
5. Copy the **LIFF ID** it generates (looks like `1234567890-AbCdEfGh`)

## Step 4 — Connect the LIFF ID to the app

Open `app.js`, find this line near the top:

```js
const LIFF_ID = "PUT_YOUR_LIFF_ID_HERE";
```

Replace it with your real LIFF ID, then re-upload the folder to Netlify
(or just drag it again — it redeploys instantly).

## Step 5 — Add it to the Official Account

In LINE Official Account Manager:
- Add a **Rich Menu** button, or a message in the greeting/menu, with the
  link: `https://liff.line.me/YOUR_LIFF_ID`
- Tapping it opens your ordering app directly inside LINE

## How orders arrive

When a customer taps "送出訂單 Send order," the app sends a formatted
text message into the LINE chat between that customer and the shop —
it shows up in the Official Account Manager's chat inbox exactly like a
normal message, e.g.:

```
📋 新訂單 New Order

原味蛋餅 x2 — NT$60
豆漿 x1 — NT$20

總計 Total: NT$80

備註 Note: 少冰
```

Your wife just reads new orders as they come into the chat — no extra
app or dashboard for her to learn.

## Testing before going live

Open the Netlify URL directly in a normal browser — the menu and cart
work outside LINE too (orders will just log to the browser console
instead of sending, since `sendMessages` only works inside the LINE
app). To test the real send flow, open the `liff.line.me/...` link from
inside LINE on your phone.

## Step 6 — Set up Supabase (order tracking + printing)

This adds order status tracking, a staff dashboard, and receipt printing.

1. Go to supabase.com, sign up free, create a new project
2. In the SQL editor, run:

```sql
create table orders (
  id uuid primary key default gen_random_uuid(),
  short_id text not null,
  items jsonb not null,
  total int not null,
  note text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  printed boolean not null default false -- staff dashboard auto-print tracking
);

alter table orders enable row level security;

-- Allow anyone with the anon key to insert/select/update.
-- Fine for a single small shop; tighten later if needed.
create policy "allow all" on orders for all using (true) with check (true);
```

3. Go to Project Settings → API. Copy the **Project URL** and the
   **anon public key**
4. Open `supabase-config.js` and paste them in:

```js
const SUPABASE_URL = "https://xxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
```

5. Re-upload the folder to Netlify

### Feature flags (tester gating for the upcoming LIFF login flow)

Optional until you're ready to test LINE login — run this whenever
that starts. In the same SQL editor:

```sql
create table feature_flags (
  line_user_id text primary key,
  is_tester boolean not null default false,
  created_at timestamptz not null default now()
);

alter table feature_flags enable row level security;

-- The app only ever needs to READ its own flag to decide whether to
-- show the (still in-progress) login flow. No insert/update/delete
-- policy is created, so those stay denied for the anon key —
-- toggling a tester on/off is a manual row edit you make here in the
-- SQL editor (or the Table Editor UI), never something the app does.
create policy "anyone can read flags" on feature_flags for select using (true);
```

To make someone a tester, you first need their LINE user ID — there's
no admin UI for this yet, so get it once manually (e.g. a temporary
`console.log(await liff.getProfile())` while testing on that person's
phone, or from LINE's own developer tools), then:

```sql
insert into feature_flags (line_user_id, is_tester) values ('U1234...', true);
```

**Before this does anything**, the LIFF app's channel needs the
`profile` scope enabled in the LINE Developers Console (Step 3 above
only turned on `chat_message.write`) — without it, `liff.getProfile()`
throws for everyone, tester or not.

### Members + test-order flagging (also part of the LIFF login rollout)

Same SQL editor, run alongside (or after) the `feature_flags` setup
above. This was originally run directly in the SQL editor ahead of
committing it here; the SQL below has since been checked column-by-
column against a real `information_schema.columns` / `pg_policies`
query against the live database (2026-09-06) — not hand-typed from
guesswork — so it's safe to treat as the actual current schema, not
just an approximation of it:

```sql
alter table orders add column user_id text;
alter table orders add column is_test boolean not null default false;

create table members (
  user_id text primary key,
  display_name text,
  picture_url text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

alter table members enable row level security;

-- Same permissive shape as `orders` — a tester's own device writes
-- this row directly via the publishable key, no server in between.
create policy "allow all" on members for all using (true) with check (true);
```

Once this is in place: a tester's checkout (see above) stamps
`orders.user_id`/`is_test` and upserts a `members` row automatically —
nothing further to configure. `staff.html`'s dashboard keeps
`is_test = true` orders out of the three live columns and out of
auto-print, showing them instead in their own "🧪 Test Orders" section
so they're still checkable by hand.

### Stored Value

**Status:** schema/functions, the staff top-up panel (`staff.html`'s
"會員儲值"), and customer checkout (see below) all exist now — this
section's own heading used to say "backend only — no staff/checkout UI
yet," which went stale as soon as the staff panel shipped and is fully
out of date after checkout wiring; corrected here rather than left
misleading for the next reader. Refunds still aren't wired up.

Backend for a per-member stored-value balance: a `members.user_id`-keyed
account with an append-only transaction log, moved only through two
`security definer` Postgres functions (never a direct table write from
the app). Run this in the same SQL editor, after `members` above (both
tables reference it via foreign key):

```sql
create table public.stored_value_accounts (
  user_id text not null,
  balance integer not null default 0,
  updated_at timestamp with time zone not null default now(),
  constraint stored_value_accounts_pkey primary key (user_id),
  constraint stored_value_accounts_user_id_fkey foreign KEY (user_id) references members (user_id)
) TABLESPACE pg_default;

create table public.stored_value_transactions (
  id uuid not null default gen_random_uuid (),
  user_id text not null,
  amount integer not null,
  type text not null,
  order_id text null,
  staff_note text null,
  created_at timestamp with time zone not null default now(),
  constraint stored_value_transactions_pkey primary key (id),
  constraint stored_value_transactions_user_id_fkey foreign KEY (user_id) references stored_value_accounts (user_id),
  constraint stored_value_transactions_type_check check (
    (
      type = any (
        array['topup'::text, 'deduction'::text, 'refund'::text]
      )
    )
  )
) TABLESPACE pg_default;

-- RLS enabled with ZERO policies on both tables, deliberately — unlike
-- orders/members ("allow all") or feature_flags (read-only), nothing
-- here should be reachable via the anon/publishable key at all, not
-- even a read. Only the service-role key (used exclusively by the
-- three Stored Value Edge Functions below) can touch these tables;
-- service_role bypasses RLS entirely in Supabase, so it's unaffected
-- by the lack of policies here.
alter table stored_value_accounts enable row level security;
alter table stored_value_transactions enable row level security;

-- Deducts only if funds cover it; single statement, row-locked, so two
-- simultaneous spend attempts can't both succeed against the same balance.
create or replace function spend_stored_value(p_user_id text, p_amount int, p_order_id text)
returns int
language plpgsql
security definer
as $$
declare v_new_balance int;
begin
  update stored_value_accounts
    set balance = balance - p_amount, updated_at = now()
    where user_id = p_user_id and balance >= p_amount
    returning balance into v_new_balance;
  if v_new_balance is null then
    raise exception 'insufficient_funds';
  end if;
  insert into stored_value_transactions (user_id, amount, type, order_id)
    values (p_user_id, -p_amount, 'deduction', p_order_id);
  return v_new_balance;
end;
$$;

create or replace function topup_stored_value(p_user_id text, p_amount int, p_staff_note text)
returns int
language plpgsql
security definer
as $$
declare v_new_balance int;
begin
  insert into stored_value_accounts (user_id, balance)
    values (p_user_id, p_amount)
    on conflict (user_id) do update
      set balance = stored_value_accounts.balance + p_amount, updated_at = now()
    returning balance into v_new_balance;
  insert into stored_value_transactions (user_id, amount, type, staff_note)
    values (p_user_id, p_amount, 'topup', p_staff_note);
  return v_new_balance;
end;
$$;

revoke execute on function spend_stored_value from public, anon, authenticated;
revoke execute on function topup_stored_value from public, anon, authenticated;
-- service_role retains execute by default — only the Edge Functions can call these.
```

Three Edge Functions call this (source in `supabase/functions/`), each
verifying identity first via the shared `_shared/verifyLineToken.ts` /
`_shared/verifyStaffPin.ts` helpers (see the LINE integration section
above) before touching money:

- **`get-stored-value-balance`** — verifies the caller's LIFF ID token,
  reads their balance. No account row yet (never topped up) reads as
  balance 0, not an error.
- **`spend-stored-value`** — verifies the LIFF ID token, calls
  `spend_stored_value()`. Returns a distinct `insufficient_funds` error
  code (not a generic failure) if the balance doesn't cover it.
- **`topup-stored-value`** — verifies a staff PIN (`STAFF_PIN` secret,
  same as elsewhere), calls `topup_stored_value()` for a `user_id`
  passed directly in the request. Selecting who to top up happens in
  `staff.html`'s "會員儲值" panel (member search by name), which also
  calls `get-stored-value-balance-staff` (same PIN gate) to show a
  balance before confirming the amount.

#### Checkout payment method

One more column, added after the schema above (same SQL editor):

```sql
alter table orders add column payment_method text not null
  default 'cash_on_pickup'
  check (payment_method in ('cash_on_pickup', 'stored_value'));
```

At checkout (`app.js`), a logged-in visitor whose balance covers the
order total is offered a payment choice — 現場付款 stays selected by
default even then (deliberate: stored value is opt-in, never assumed)
alongside "使用儲值支付（餘額：NT$X）" showing their real balance. Guests
and anyone whose balance doesn't cover the total never see the choice
at all — no partial-spend UI, same no-partial-split decision as
elsewhere in this app. Submitting with stored value selected generates
the order's id client-side and calls `spend-stored-value` with it
*before* the order itself is inserted; the order is only ever saved
(with that same id, `payment_method = 'stored_value'`) once the spend
actually succeeds. A spend failure (most likely `insufficient_funds`
from a race with a concurrent order elsewhere, since the balance was
already checked once when the sheet opened) shows a clear message and
lets the visitor retry with cash instead of blocking checkout outright.
The printed customer label's payment line (see `print.js`) reflects
whichever method the order actually used.

### Favourites

```sql
create table if not exists favorites (
  user_id text not null,
  item_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table favorites enable row level security;
create policy "Allow all" on favorites for all using (true) with check (true);
```

Deliberately the same permissive "allow all" shape already used for
`orders`/`members`, not the hardened zero-policy + Edge Function
pattern used for Stored Value — favouriting isn't money, and a client
can already write `orders.user_id` for anyone via the anon key today,
so this doesn't introduce a new weakness. Written to directly from
`app.js` via the existing Supabase client, no Edge Function.

Member-only: a star toggle (☆/★) appears on every item card (browse
list, search results, popular row) only while logged in, optimistically
flipped in the UI on tap and then inserted/deleted in `favorites` to
match. A "我的最愛" row (same item-card component, positioned next to
熱門) shows the member's favourited items whenever they have any; with
zero favourites it shows "常買推薦" instead — the top 3–5 `item_id`s by
occurrence across that member's own past orders (computed client-side
from the existing `orders` table, no new table for this) — and if they
have no past orders either, the row is hidden entirely rather than
showing empty.

### Weekday Stamp Card

Replaces the old "reward points" concept entirely — spend NT$85+ on
each of Monday–Thursday (calendar day, **Asia/Taipei**, not UTC — see
`_shared/taipeiWeek.ts`) and Friday unlocks one free drink from 飲品,
capped at NT$35 (a pricier drink like 拿鐵/美式咖啡 just costs the
difference). One redemption per member per week.

```sql
create table if not exists stamp_redemptions (
  user_id text not null,
  week_start date not null, -- the Monday of the week, Asia/Taipei
  order_id uuid not null,
  redeemed_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table stamp_redemptions enable row level security;
-- zero policies: default-deny, same posture as stored_value_accounts /
-- stored_value_transactions, because this gates a monetary discount.
-- The primary key on (user_id, week_start) is also the double-claim
-- guard: a second redemption insert for the same week fails atomically,
-- same pattern as spend_stored_value()'s balance check.
```

Two Edge Functions, both verifying the caller's LIFF ID token (same
`_shared/verifyLineToken.ts` as Stored Value's customer-facing
functions — no staff PIN involved, this is entirely customer-initiated)
and sharing one `_shared/stampProgress.ts` helper so "is this week
unlocked/redeemed" can only ever be computed one way, not two
functions quietly drifting out of sync with each other:

- **`get-stamp-progress`** — for each of Mon/Tue/Wed/Thu (this week,
  Asia/Taipei), sums that member's order totals for the day and
  compares to NT$85; checks `stamp_redemptions` for this week. Returns
  `{ days: [mon,tue,wed,thu], unlocked, redeemed, weekStart }`.
- **`redeem-stamp-drink`** — re-derives unlocked/redeemed/is-it-Friday
  itself from the database (via the same shared helper) rather than
  trusting anything the client claims; rejects if any of those don't
  hold. Otherwise inserts into `stamp_redemptions` — the primary key
  rejects a concurrent double-redeem atomically, surfaced as the same
  `already_redeemed` error a plain re-check would give.

At checkout (`app.js`), a logged-in member's stamp progress is fetched
once at page load (not re-checked per checkout-sheet open the way
Stored Value's balance is — a day's qualifying spend/this week's
redemption don't meaningfully change mid-session). If it's Friday and
this week is unlocked and not yet redeemed, a banner appears in
checkout; picking a drink is just adding it to the cart like any other
item, no special picker. Submitting calls `redeem-stamp-drink` with the
client-generated order id *before* inserting the order (same
sequencing as Stored Value's spend), and only discounts the total
(`min(drink price, 35)`, the most expensive 飲品 line if more than one
qualifies) once that call actually succeeds — a failure (most likely a
concurrent redemption elsewhere) doesn't block checkout, it just falls
back to charging full price. **Not addressed in this pass:** the
itemized lines on the order (and so the printed receipt / LINE chat
message) still show each item at full price even when the total is
discounted — the total is correct, but staff/customer would need to
infer the redemption rather than see it itemized. Revisit if that
turns out to matter in practice.

The 5-circle progress widget (member benefits card — see
`buildStampCardRow()`/`refreshStampWidgetUI()`) replaces the old
"累積點數" placeholder caption. Reaching it while logged in is via a new
"集點進度" entry in the member-menu popover (tap the header badge) —
the card itself (`#benefits-card`) was previously only ever opened
pre-login as a sign-up pitch; this reuses it rather than building a
second dialog, hiding its login button when already signed in.

## Step 7 — Set up the staff tablet

1. On the Android tablet, open **Chrome** and go to your Netlify URL +
   `/staff.html` (e.g. `https://yourshop-order.netlify.app/staff.html`)
2. Add it to the home screen (Chrome menu → "Add to Home screen") so it
   opens like an app
3. Plug the USB thermal printer into the tablet (use a USB-OTG
   adapter/cable if the tablet only has USB-C)
4. Tap **"連接印表機 Connect printer"** — Chrome will show a device
   picker; select the printer. This permission is remembered, so you
   only need to do this once (until the printer is unplugged and a
   different port/cable is used)
5. New orders appear in the **Pending** column automatically (checks
   every 5 seconds). Tapping **Start** moves it to Preparing, **Ready**
   moves it to the Ready column, **Picked up** clears it

### If Chinese text prints as garbled characters

This depends on your specific printer model's supported codepages.
Check the printer's manual for its GB18030 or Big5 codepage command,
and let me know the model — I'll adjust `print.js` to send the right
codepage-switch command before printing.

## How pickup time is estimated

Each order's wait estimate = (items in that order × ~3 min) + (orders
already ahead in the queue × ~4 min buffer), with a 10-minute floor.
These numbers are guesses to start with — once you've run it for a
week, tell me the real average prep times and I'll tune
`AVG_MINUTES_PER_ITEM` and `QUEUE_BUFFER_MINUTES` in
`supabase-config.js` to match.

## Later upgrades (optional, still mostly free)

- **Online payment** → integrate LINE Pay
- **Push notification to customer when ready** → needs the Messaging
  API on a small server function (e.g. a Vercel function), still free
  tier at this volume
- **Daily sales summary** → a simple query against the `orders` table,
  could even be a page you check each night
