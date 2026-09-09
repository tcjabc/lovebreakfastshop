# Love Breakfast Shop — Ordering App

## What this is

A LINE-integrated online ordering app for a Taiwanese breakfast shop
(grab-and-go, no dine-in). Customer orders through a LIFF (LINE
Front-end Framework) web app opened from the shop's LINE Official
Account; staff manage the order queue and print receipts on a tablet
in the shop. Built to run on entirely free infrastructure.

**Owner's GitHub:** personal account `tcjabc`, repo `lovebreakfastshop`,
pushed via the `github.com-second` SSH alias (not the default
`github.com` host — see local `\~/.ssh/config` if re-cloning elsewhere).

## Architecture (deliberately no build step)

Plain HTML/CSS/vanilla JS. No `package.json`, no bundler, no
framework. External libraries (LIFF SDK, Supabase client) load via
CDN `<script>` tags directly in the HTML files. This was a deliberate
choice to keep hosting free and setup simple — **do not introduce a
build step, npm dependencies, or a framework unless explicitly asked**.

To run locally: `npx serve .` from the repo root (no install step
needed beyond that). Opening `index.html` directly via `file://` does
NOT work for `staff.html` — WebUSB requires a secure context
(`localhost` or real HTTPS).

## Files

|File|Purpose|
|-|-|
|`index.html` / `app.js` / `style.css`|Customer-facing ordering app (opens in LIFF)|
|`menu.js`|Menu data + shop info — edited directly, no admin UI|
|`staff.html` / `staff.js` / `staff-style.css`|Staff tablet dashboard: order queue (Pending/Preparing/Ready), print button|
|`print.js`|ESC/POS receipt building (separate kitchen ticket + customer label documents) + WebUSB printer connection (Chrome-on-Android only)|
|`supabase-config.js`|Supabase client + order insert/favourites/order-history helpers, shared by customer and staff apps|
|`supabase/functions/`|Deno Edge Functions for Stored Value and the Weekday Stamp Card — the only code in this repo that runs server-side. Verifies identity (LINE ID token or staff PIN) before touching money; see "Server-side identity verification" below|
|`worker.js`|Cloudflare Worker entrypoint — PIN-gates `/staff/*` only; every other request is served as a plain static asset without this file running at all. See "Deployment: Cloudflare Workers (not Pages)" below|
|`wrangler.jsonc`|Worker config: `main` (`worker.js`), the `assets` binding, and `assets.run_worker_first` scoping the gate to `/staff/*`|
|`.assetsignore`|Excludes `.git`, `.gitignore`, `CLAUDE.md`, `README.md`, `.dev.vars`, and `node_modules` from the public static-asset upload — see "Deployment" below before touching this or `assets.directory`|
|`README.md`|Full setup walkthrough (LINE Developer Console, LIFF, Supabase, Cloudflare Workers, printer pairing)|

## Deployment: Cloudflare Workers (not Pages)

This repo deploys as a **Cloudflare Worker with static assets**
(`wrangler deploy`), not Cloudflare Pages — there is no `functions/`
directory convention here, and Pages' auto-detected `_middleware.js`
routing does not apply. `wrangler.jsonc` sets `main: "worker.js"`,
`assets.directory: "./"`, `assets.binding: "ASSETS"`, and
`assets.run_worker_first: ["/staff/*"]` — that last field means
`worker.js`'s `fetch` handler only ever runs for requests under
`/staff`; every other request (the whole customer ordering app) is
served straight from the `assets` binding with zero Worker invocation,
same as before the staff PIN gate existed. Live at a `*.workers.dev`
subdomain (or a custom domain if one's attached to the Worker).

**Status as of 2026-09-10:** an earlier pass at the staff PIN gate
wrongly assumed this project was Cloudflare Pages and shipped a
`functions/staff/_middleware.js` — Pages' directory convention, never
read by a Workers deploy, so it would silently never have run. Fixed
by replacing it with `worker.js`; if you're reading an old summary of
this work that mentions a `functions/` directory or Pages Functions,
it's describing that mistake, not the current setup.

Secrets (`STAFF_DASHBOARD_PIN`, `STAFF_DASHBOARD_SECRET` — see "Staff
dashboard PIN gate" below) are set via `wrangler secret put <NAME>`,
or from the Cloudflare dashboard (Workers & Pages → this Worker →
Settings → Variables and Secrets) — never hardcoded or committed.

**`.assetsignore`** exists because `assets.directory: "./"` is the
repo root: without it, `wrangler deploy` would publish `.git/` (the
entire commit history and object store), `.gitignore`, `CLAUDE.md`,
and `README.md` as publicly fetchable static files — confirmed via
`wrangler deploy --dry-run` before this file existed. Don't widen
`assets.directory` away from a `.assetsignore`-covered root, and don't
delete or narrow `.assetsignore`'s entries, without re-checking that
this doesn't reopen that exposure — see "Things NOT to change without
discussion" below.

## Staff dashboard PIN gate

`/staff/*` (the whole subtree — `staff/index.html` and its sibling
`staff-style.css`/`staff.js`, not just the index page) requires a PIN
before any file in it is served, enforced entirely server-side in
`worker.js` — there is no client-side check to bypass by viewing page
source, since an unauthenticated request never receives the real
dashboard markup at all.

* Session: a `staff_session` cookie, `<timestamp>.<hmac>`, where hmac
  is HMAC-SHA256(timestamp, `STAFF_DASHBOARD_SECRET`) via the Web
  Crypto API, valid for 12 hours. Set with
  `HttpOnly; Secure; SameSite=Lax; Path=/staff` on a correct PIN.
* PIN comparison is constant-time (never `===`), mirroring
  `supabase/functions/_shared/verifyStaffPin.ts`'s helper of the same
  shape — kept as a separate copy since Edge Functions and Workers are
  different runtimes with no shared import path between them.
* Two secrets, `STAFF_DASHBOARD_PIN` and `STAFF_DASHBOARD_SECRET` —
  **deliberately not named `STAFF_PIN`/`STAFF_SECRET`.** `STAFF_PIN` is
  already a distinct Supabase Edge Function secret (see
  `supabase/functions/_shared/verifyStaffPin.ts`) gating a different,
  unrelated thing — the "會員儲值" top-up panel *inside* this same
  dashboard, checked via `topup-stored-value` and
  `get-stored-value-balance-staff`. Different platform (Supabase
  secrets vs. Cloudflare Worker secrets), so there's no actual
  technical collision, but reusing the name for two different gates
  would invite exactly the mix-up these distinct names avoid.

## Backend: Supabase

Free-tier Supabase project already created (`lovebreakfastshop`,
Asia-Pacific/Tokyo region). Nine tables as of this writing: `orders`,
`feature_flags`, `members`, `favorites`, `stored_value_accounts`,
`stored_value_transactions`, `stamp_redemptions`, `pickup_slots`, and
`daily_order_counters`. **Most of the schema (columns/types/defaults)
and RLS policies live in README.md — "Set up Supabase" (Step 6),
"Feature flags," "Members + test-order flagging," "Stored Value,"
"Favourites," and "Weekday Stamp Card" — deliberately not repeated
here, so there's a single source instead of two copies that can drift
out of sync.** Two exceptions, both real gaps rather than deliberate
omissions:

* `pickup_slots`/`reserve_pickup_slot()` — README's "Pickup time
  slots" section explicitly says this was set up directly in the SQL
  editor and isn't repeated there, matching this file's usual
  "SQL lives in one place" rule (that place just isn't README for this
  one table).
* `daily_order_counters`/`next_daily_order_number()` (added in commit
  `ab661d0`, backing the sequential `short_id` — see "Daily order
  numbers" below) — `supabase-config.js`'s own comment on
  `makeRealShortId()` says "see README.md/SCHEMA," but README.md has
  no section on this table or function at all. **Flagging, not
  guess-fixing:** either the SQL needs to actually be added to
  README.md (most likely — matching the `pickup_slots` precedent would
  mean a short "set up directly, not repeated here" note instead), or
  the comment's pointer is just wrong. Worth confirming with whoever
  ran that SQL before writing anything into README.md on their behalf.

RLS is enabled on every table, but the posture splits in two, by
whether the table touches money/redemptions:

* `orders`, `members`, `favorites`: permissive (`allow all`) for the
  anon/publishable key. Fine for a single-shop app with no auth — a
  client can already write `orders.user_id` for anyone via the anon
  key today, so `favorites` being equally open doesn't introduce a new
  weakness (see README's "Favourites" section).
* `feature_flags`: read-only for the anon key by design (toggling a
  tester is meant to require a manual Supabase edit, never something
  the app itself can do).
* `stored_value_accounts`, `stored_value_transactions`,
  `stamp_redemptions`: **zero RLS policies — default-deny for both
  anon and authenticated.** Nothing in these three is reachable except
  through the service-role key (which bypasses RLS entirely), used
  exclusively by the Edge Functions in `supabase/functions/` — see
  "Server-side identity verification" below. This is deliberate: these
  three are the only tables a client writing `orders.user_id` for
  someone else could otherwise use to move real money or claim a
  reward that wasn't earned.

`supabase-config.js` uses Supabase's newer key naming: the
**publishable key** (`sb\_publishable\_...`), not the legacy anon key —
functionally equivalent, safe to expose client-side, and already
committed to this public repo (RLS is the real access control, not
key secrecy). The **secret key** must never be added to any file in
this repo — the Edge Functions get it as a Supabase-managed secret,
not from anything checked in here.

## Server-side identity verification (Edge Functions)

`orders`/`members`/`favorites` staying permissive RLS (above) is fine
because nothing about them moves money. Stored Value and the Weekday
Stamp Card do, so they can't rely on a client-supplied `user_id` the
way the rest of the app does — anyone with devtools open could POST an
`orders` row with someone else's `user_id` today, and that's an
accepted risk for a free breakfast order but not for a cash balance.
Every Stored Value/Stamp Card Edge Function (`supabase/functions/`)
verifies identity itself before trusting anything, via one of two
shared helpers in `supabase/functions/_shared/`:

* **`verifyLineToken.ts`** — for the customer-initiated functions
  (`get-stored-value-balance`, `spend-stored-value`,
  `get-stamp-progress`, `redeem-stamp-drink`): POSTs the caller's LIFF
  ID token to LINE's own `https://api.line.me/oauth2/v2.1/verify`
  endpoint and only trusts the `sub` claim LINE hands back, never a
  `user_id` the client sends directly. Distinguishes expired/
  wrong-audience/invalid/network failures via `err.code` rather than
  string-matching messages.
* **`verifyStaffPin.ts`** — for the staff-initiated functions
  (`topup-stored-value`, `get-stored-value-balance-staff`): staff have
  no LINE identity of their own, so these gate on the `STAFF_PIN`
  Edge Function secret instead, compared with a constant-time check
  (never `===`) so response timing can't leak the PIN a character at a
  time.

Both spend and top-up ultimately call a `security definer` Postgres
function (`spend_stored_value()`/`topup_stored_value()`) with
`execute` revoked from `anon`/`authenticated` — so even a stray direct
table write can't move a balance; only those two functions, called
only from Edge Functions holding the service-role key, can. Redeeming
a stamp-card drink is a plain insert into `stamp_redemptions` instead
(no Postgres function), but gets the same effective protection from
the table's default-deny RLS plus the `(user_id, week_start)` primary
key rejecting a concurrent double-redeem atomically.

## LINE integration status

* `LIFF\_ID` in `app.js` is a real LIFF app ID as of commit `c8b9470`
— this section previously said it was still the placeholder; that
was stale, not current. `liff.isInClient()` still guards
`liff.sendMessages()`/`liff.closeWindow()` so the app degrades
gracefully outside LINE.
* **Membership login is opt-in, not forced — a prior design in this
same file briefly had it forcing everyone into LINE's OAuth page on
page load; that was reversed, so if you're reading an old summary of
this section, don't trust it.** `syncMemberState()` in `app.js` runs
once from `init()` at page load and only ever does a *silent*
`liff.isLoggedIn()` check — it never calls `liff.login()` itself.
Already logged in (e.g. a returning visitor, or LIFF's in-client
silent auto-login already having happened) → `showMemberBadge()`.
Not logged in → `showMemberPill()` (header pill, "成為會員 Become a
Member"). Anonymous browsing is fully preserved; nothing about page
load can trigger LINE's login UI.
* **`loginWithLine()` in `app.js` is the ONLY place `liff.login()` is
called, and it only ever runs from an explicit tap** — either the
"成為會員" pill's benefits card (`#benefits-card`, opened by
`openBenefitsCard()`, closable via its X or backdrop with zero side
effects — no flag set, always reopenable) or the checkout dialog (see
below). `syncLoggedInProfile()` is the shared "what happens once we
have a real profile" step (`isTesterMode()` → `upsertMember()` →
`showMemberBadge()`), used by both the silent page-load check and a
successful explicit login so the two can't drift apart.
* **Checkout dialog**: `submitOrder()` shows a "使用 LINE 登入" /
"以訪客身份下單" choice for a currently-anonymous visitor, but only
once per session — after "guest" is tapped once, `guestCheckoutChosen`
(module-level, in-memory, not persisted) skips the dialog for every
later checkout in that session. Dismissing via the backdrop places no
order at all (same as choosing neither button). Tapping "guest"
proceeds exactly like checkout always has (`user_id` null). Tapping
the LINE button calls `loginWithLine()`; outside LINE this is a real
redirect (page unloads — the order does NOT get placed in that call,
and the in-memory cart is lost on the way back, same as any full page
reload today — there's no cart persistence across it), while
already-logged-in-in-client resolves synchronously and the order
proceeds attributed to that identity in the same call.
* **`isTesterMode()` (`supabase-config.js`) is back, but its purpose
changed — it is NOT a login gate anymore, and hasn't been since this
redesign.** Login is available to everyone, always, by their own
choice. `isTesterMode(userId)` now only decides whether a *logged-in*
user's orders get `is_test = true`, so the shop owner's own testing
orders land in `staff.html`'s Test Orders section instead of the live
kitchen queue/auto-print. Called from `syncLoggedInProfile()` on every
login. `feature_flags` (table, RLS policy, existing seeded row) was
never dropped through any of this — only what the flag controls
changed.
* The LIFF channel's scopes only had `chat_message.write` enabled
(see README.md Step 3) — `profile` scope was turned on in the LINE
Developers Console to get this far; if `liff.getProfile()` ever starts
failing for everyone, check that scope first.

## Hidden/toggle bug pattern (context for git history)

`style.css` sets `display: flex` directly on both `.cart-bar` and
`.confirm-screen`, which silently overrides the HTML `hidden`
attribute (author-stylesheet `display` beats the user-agent
`[hidden]` rule regardless of specificity — not a JS bug). This
previously caused the confirmation overlay to be visible on every
page load regardless of order state.

**Status as of 2026-09-04:** this was earlier logged in this file as
already fixed, but `git log --follow -- style.css` showed only the
repo's initial commit touching that file — the override had never
actually been committed. `.confirm-screen[hidden] { display: none; }`
has now been added directly after the `.confirm-screen` rule in
`style.css`, so the confirmation overlay is fixed and verified
(fresh load → hidden; checkout → shown; close → hidden again).

**Update: `.cart-bar` is also fixed, not open.** This file previously
listed `.cart-bar[hidden] { display: none; }` as the identical bug,
still needing the same fix. Checking `git log -S".cart-bar\[hidden\]"
-- style.css` shows it, along with `.confirm-screen[hidden]`, actually
landed together in commit `04696fa` ("Real menu data, per-item
customization, and Signature Red rebrand") — before this file's
previous revision was written, which just never got updated to match.
Both overrides are present in the current `style.css` (search
`[hidden]` if this ever needs re-verifying). `.empty-state`,
`.sheet-backdrop`, and `.checkout-sheet` were checked and don't set an
unconditional `display` in CSS, so they're unaffected. If similar
hidden/toggle bugs appear elsewhere, check for this same pattern
first: does the element's own CSS rule set `display` unconditionally
without a paired `[hidden]` override?

## Receipt printing: GB18030 encoding + daily order numbers

Two related fixes landed together in commits `b6b1723`/`ab661d0`
(2026-09-07/08), replacing an earlier "plain UTF-8, likely garbled on
real hardware" caveat that no longer applies:

* **Root cause:** the real printer (Xprinter XP-Q200) doesn't decode
  raw UTF-8 — it decodes through its own built-in GB18030-ish table by
  default, which is why Chinese text printed as *different-but-valid*
  Chinese characters rather than obvious garbage (easy to miss on a
  quick glance at a test print). Fix: `print.js`'s `textToBytes()` now
  runs every character through a hand-built `GB18030_TABLE` — every
  CJK/fullwidth character actually used anywhere in the project
  (menu.js, app.js, staff.js, print.js, the HTML files), mapped to its
  real GB18030 bytes and confirmed against the real printer — before
  falling back to raw UTF-8 for anything outside that table (e.g. an
  unusual character typed into a customer note). `ab661d0` filled in
  gaps the first pass missed (found by re-scanning every file for
  non-ASCII characters and diffing against the table): the stamp-card
  progress circles (●/○) and the line-truncation ellipsis (…).
* **Daily order numbers:** real orders now get a sequential,
  daily-resetting `short_id` (e.g. `"007"`) via a new
  `next_daily_order_number()` Postgres function + `daily_order_counters`
  table (see the schema gap noted above), claimed atomically so two
  orders landing at the same instant can't collide. Test orders
  (`is_test = true`) deliberately keep the old random letter+number
  scheme (`makeTestShortId()`, e.g. `"B482"`) instead of going through
  the counter — it now doubles as a built-in "this is a test order"
  marker, visually distinct from any real order's plain zero-padded
  number, with no separate on-screen flag needed. Both live in
  `supabase-config.js`; `insertOrder()` picks which one to call based
  on `isTest`.

## Deliberate design decisions — do not reverse without asking

* **No "order ready" push notification.** Explicitly decided against:
this is a grab-and-go shop with real estimated travel time between
order and pickup, so a ready-now ping either arrives too late (food
gets cold waiting) or nags someone still traveling. The one-time
pickup-time estimate shown at checkout (`estimateWaitMinutes()` in
`supabase-config.js`) is the intended UX — don't add push
notifications back in.
* **LINE's Messaging API push quota (200 free messages/month on the
OA's current plan) is intentionally untouched** by this app for the
same reason above. `liff.sendMessages()` (customer→OA, used for the
optional chat echo) is a different mechanism and doesn't count
against that quota — don't confuse the two if extending messaging
features.
* **The custom loyalty system is built now — this bullet previously
said points were "not yet built"; that's stale.** The original
points-system idea was replaced outright by the **Weekday Stamp Card**
(集點, commit `82aa0ad`: "Add Weekday Stamp Card, replacing the
reward-points concept") rather than built alongside it — don't propose
a separate points balance, that ship has sailed. Both this and
**Stored Value** (儲值, prepaid cash balance) are tied to LINE login
specifically, for the same reasons the points plan was: they (a)
auto-apply at checkout with no staff action, and (b) restrict the
incentive to app orders only, as a deliberate nudge away from phone/
in-person ordering. LINE's native Shop Card/Reward Card feature and
LINE Touch NFC tags were both evaluated and rejected for this same
reason — still don't suggest either as the primary loyalty mechanism,
only as a fallback if a custom build is ever out of scope. See "Loyalty
system status" below for what's shipped vs. still open.
* **All user-facing display text is Chinese-only, site-wide** — this
supersedes an earlier, narrower rule that only the total/order-number
lines on the printed receipt were allowed to carry English. New
UI text (buttons, dialogs, headers, alerts, printed receipts, LINE
chat messages, the staff dashboard) should be written in Chinese
only, not bilingual, matching the menu item names' existing
convention. This applies to genuinely user-facing display strings —
not code comments, `id`/`class`/variable names, or file names, which
stay in English as normal. Two narrow exceptions: a proper noun
embedded in an otherwise-Chinese sentence (e.g. "與LINE連動",
"USB 連接") isn't a parallel English translation and doesn't need
touching; `NT$` stays as the currency prefix throughout, not treated
as English prose.

## Loyalty system status

The Membership login flow described above (opt-in, header pill or
checkout dialog) now backs three real member-only features, not
placeholders — the benefits card's three rows (`MEMBER_BENEFIT_CAPTIONS`
in `app.js`) each name one of these and each is actually built:

* **Weekday Stamp Card (集點)** — spend ≥ NT$85 on each of Mon–Thu
  (Asia/Taipei) unlocks one free drink (capped NT$35), redeemable
  Friday only, once per member per week. See README's "Weekday Stamp
  Card" section and "Server-side identity verification" above.
* **Stored Value (儲值)** — prepaid cash balance, cash top-up only via
  a staff-PIN-gated panel in `staff.html`. See README's "Stored Value"
  section.
* **Favourites** — member-only star toggle on any item card, plus a
  "我的最愛"/"常買推薦" row. Permissive RLS like `orders`/`members`
  (not the locked-down pattern above) since it isn't money — see
  README's "Favourites" section.

**Known gaps, not yet done:**

* **Staff-side pickup-time queue filter/sort.** Checkout reserves a
  real 15-minute slot (`reserve_pickup_slot()`, see README's "Pickup
  time slots") and both printed tickets show it, but `staff.js`'s
  order queue itself has no sort/filter by `pickup_slot` yet — it's
  purely FIFO by `created_at`, same as before slots existed.
* **Stored Value refunds.** Spend and top-up are both wired end-to-end;
  refunds (e.g. a cancelled order that was paid with stored value)
  aren't — see README's "Stored Value" status note.
* **Stamp-card discount isn't itemized on receipts.** When a stamp-card
  drink is redeemed, the printed/chat receipt's line items still show
  full price even though the total is correctly discounted — see
  README's "Weekday Stamp Card" section, "Not addressed in this pass."
* **`AVG_MINUTES_PER_ITEM`/`QUEUE_BUFFER_MINUTES`/`estimateWaitMinutes()`/
  `getQueueCount()`** (`supabase-config.js`) — this file used to list
  "tune these once there's real prep-time data" as a next step. That's
  moot now: real reserved pickup slots replaced the queue-based
  estimate they fed, and per README's "Pickup time slots" section
  these functions are no longer called from anywhere. Left in place in
  case a queue-based estimate is wanted again in some form; safe to
  delete otherwise.
* **Real LIFF app / `LIFF_ID`** — already done, not a next step. See
  "LINE integration status" above; keeping this note only because an
  earlier revision of this file listed it as still pending.

## Things NOT to change without discussion

* Don't add a build step / bundler / framework (see Architecture)
* Don't add push notifications for order-ready status
* Don't switch primary loyalty mechanism to LINE's native Shop Card
or LINE Touch NFC (fine to mention as a manual fallback option)
* Don't remove the `\[hidden] { display: none }` CSS override
* Don't rename `supabase-config.js`'s exported variable names
(`SUPABASE\_URL`, `SUPABASE\_ANON\_KEY`) — `staff.js` and `app.js` both
reference these directly
* Don't add RLS policies to `stored_value_accounts`,
`stored_value_transactions`, or `stamp_redemptions`, and don't write to
them directly from client code — the zero-policy/service-role/Edge-
Function pattern is what makes these safe to hold real money and
redemption state; see "Server-side identity verification" above
* Don't trust a client-supplied `user_id` inside a Stored Value/Stamp
Card Edge Function — always re-derive it from `verifyLineToken()` (or
gate on `verifyStaffPin()` for the staff-initiated ones)
* Don't widen `assets.directory` in `wrangler.jsonc`, or delete/narrow
`.assetsignore`, without re-checking why each entry is there —
`assets.directory` is the repo root, and `.assetsignore` is the only
thing stopping `.git/` (full history) and other non-public files from
being deployed as public static assets; see "Deployment: Cloudflare
Workers (not Pages)" above
* Don't reuse `STAFF_PIN`/`STAFF_SECRET` as the Cloudflare Worker
secret names for the staff dashboard PIN gate — those would collide in
name (not in mechanism) with the distinct, already-existing Supabase
`STAFF_PIN` secret; use `STAFF_DASHBOARD_PIN`/`STAFF_DASHBOARD_SECRET`,
see "Staff dashboard PIN gate" above
## Git workflow
* Never run `git commit` or `git push` automatically after making
* changes, even if a change is complete and tests pass. The owner
* reviews every change manually and commits/pushes themselves. It's
* fine to run `git diff` or `git status` to show what changed, or to
* suggest a commit message — just don't execute the commit or push
* yourself unless explicitly asked to in that specific instance.

