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
3. **(Later) Loyalty system** — more of this exists now, opt-in rather
than tester-gated or forced (see "LINE integration status" above): a
visitor can log in anytime via the header pill's benefits card, or at
checkout; `orders.user_id` gets stamped when they do, and a `members`
row (`user_id`, `display_name`, `picture_url`, `last_seen_at`) is
upserted per login. Still to do: `points`/`total_orders` columns on
`members` (or a separate table — undecided), an auto-increment on
order insert, and a checkout-time reward-application step. The
benefits card's three placeholder rows already name what these three
features are (points, stored value, favourites) — building them is
filling in that promise, not inventing new scope. Additive to the
existing schema, not a rebuild.

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

