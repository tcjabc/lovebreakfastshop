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
|`print.js`|ESC/POS receipt building + WebUSB printer connection (Chrome-on-Android only)|
|`supabase-config.js`|Supabase client + order insert/queue-count helpers, shared by customer and staff apps|
|`README.md`|Full setup walkthrough (LINE Developer Console, LIFF, Supabase, Netlify/Cloudflare, printer pairing)|

## Backend: Supabase

Free-tier Supabase project already created (`lovebreakfastshop`,
Asia-Pacific/Tokyo region). Three tables: `orders`, `feature_flags`,
`members`. **The exact schema (columns/types/defaults) and RLS
policies live in ONE place — README.md's "Set up Supabase" steps
(Step 6, "Feature flags," and "Members + test-order flagging") —
deliberately not repeated here, so there's a single source instead of
two copies that can drift out of sync. Some of that SQL was run
directly in the Supabase SQL editor ahead of committing it anywhere;
README.md's copy has since been confirmed to exactly match a real
`information_schema`/`pg_policies` query against the live database
(2026-09-06), not hand-reconstructed.**

RLS is enabled on all three tables: `orders`/`members` are permissive
(`allow all`); `feature_flags` is read-only for the anon key by design
(toggling a tester is meant to require a manual Supabase edit, never
something the app itself can do). Fine for a single-shop app with no
auth. If auth is ever added (see Loyalty section below), tighten this.

`supabase-config.js` uses Supabase's newer key naming: the
**publishable key** (`sb\_publishable\_...`), not the legacy anon key —
functionally equivalent, safe to expose client-side, and already
committed to this public repo (RLS is the real access control, not
key secrecy). The **secret key** must never be added to any file in
this repo.

## LINE integration status

* `LIFF\_ID` in `app.js` is a real LIFF app ID as of commit `c8b9470`
— this section previously said it was still the placeholder; that
was stale, not current. `liff.isInClient()` still guards
`liff.sendMessages()`/`liff.closeWindow()` so the app degrades
gracefully outside LINE.
* **`liff.getProfile()` now exists, and IS wired into `orders`/
`members` — but still only behind a tester gate.** `maybeTesterLogin()`
in `app.js` (called at the top of `submitOrder()`) does
`liff.isLoggedIn()` → `liff.login()` if needed → `liff.getProfile()`,
but only for a user `isTesterMode()` (in `supabase-config.js`) says is
a tester — everyone else's checkout is untouched, no login prompt,
`orders.user_id` stays null, `orders.is_test` stays false, no
`members` row is touched. For a tester, `submitOrder()` awaits
`upsertMember(profile)` (insert-or-refresh `display_name`/
`picture_url`/`last_seen_at`, never touches `created_at` on an
existing row) and passes `userId`/`isTest` into `insertOrder()`.
* **The tester gate — `isTesterMode(userId)` in `supabase-config.js`
— is the ONLY place in the codebase that should ever decide "is
this user a tester."** Backed by the `feature_flags` table above.
Toggling a tester is a Supabase row edit, never a code change. When
the login flow ships for everyone, delete `isTesterMode()` and its
one call site in `maybeTesterLogin()` — but keep the `userId`/
`isTest` plumbing into `insertOrder()`/`upsertMember()`, since that
part becomes correct-for-everyone once nothing gates it anymore, not
dead code to remove.
* The LIFF channel's scopes only had `chat_message.write` enabled
(see README.md Step 3) — `profile` scope was turned on in the LINE
Developers Console to get this far; if `liff.getProfile()` ever
starts failing for everyone, tester or not, check that scope first.
* The first tester was bootstrapped via a temporary `console.log`
block in `app.js`'s `init()` (added in commit `339c639`, made active
in `68fc439`, removed in `edac663`) — that block is gone now that
`feature_flags` has its first real row; don't re-add it as a
permanent fixture if a second tester needs bootstrapping later,
re-add-then-remove it the same way instead.

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

**Still open:** `.cart-bar` has the identical bug — it's `hidden` by
default in `index.html` and toggled via `bar.hidden` in `app.js`
(`updateCartBar()`), but `style.css` has no `.cart-bar[hidden]`
override, so the cart bar likely renders even with an empty cart.
Needs the same fix (`.cart-bar[hidden] { display: none; }` after the
`.cart-bar` rule) — not yet applied. `.empty-state`,
`.sheet-backdrop`, and `.checkout-sheet` were checked and don't set
an unconditional `display` in CSS, so they're unaffected. If similar
hidden/toggle bugs appear elsewhere, check for this same pattern
first: does the element's own CSS rule set `display` unconditionally
without a paired `[hidden]` override?

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
* **Reward/loyalty points are not yet built.** Discussed but
deliberately deferred: the plan (see below) is a custom points
system tied to LINE login specifically because it's the only option
that can (a) auto-apply at checkout with no staff action, and (b)
restrict the incentive to app orders only (as a deliberate nudge
away from phone/in-person ordering). LINE's native Shop
Card/Reward Card feature and LINE Touch NFC tags were both
evaluated and rejected for this reason — don't suggest either as
the primary loyalty mechanism, only as a fallback if the custom
build is out of scope.

## Next steps, roughly in order

1. **Create the real LIFF app** in the LINE Developers Console once a
real hosted URL exists, and swap the real `LIFF\_ID` into `app.js`.
2. **Tune `AVG\_MINUTES\_PER\_ITEM` / `QUEUE\_BUFFER\_MINUTES`** in
`supabase-config.js` once there's a week or two of real prep-time
data — current values are starting guesses.
3. **(Later) Loyalty system** — more of this exists now, still
tester-gated (see "LINE integration status" above):
`liff.login()`/`getProfile()` runs end-to-end at checkout for a
flagged tester, `orders.user_id`/`is_test` get stamped, and a
`members` row (`user_id`, `display_name`, `picture_url`,
`last_seen_at`) is upserted. Still to do: `points`/`total_orders`
columns on `members` (or a separate table — undecided), an
auto-increment on order insert, a checkout-time reward-application
step, and — once the login flow is proven out — removing the tester
gate so it applies to everyone. Additive to the existing schema, not
a rebuild.

## Things NOT to change without discussion

* Don't add a build step / bundler / framework (see Architecture)
* Don't add push notifications for order-ready status
* Don't switch primary loyalty mechanism to LINE's native Shop Card
or LINE Touch NFC (fine to mention as a manual fallback option)
* Don't remove the `\[hidden] { display: none }` CSS override
* Don't rename `supabase-config.js`'s exported variable names
(`SUPABASE\_URL`, `SUPABASE\_ANON\_KEY`) — `staff.js` and `app.js` both
reference these directly
## Git workflow
* Never run `git commit` or `git push` automatically after making
* changes, even if a change is complete and tests pass. The owner
* reviews every change manually and commits/pushes themselves. It's
* fine to run `git diff` or `git status` to show what changed, or to
* suggest a commit message — just don't execute the commit or push
* yourself unless explicitly asked to in that specific instance.

