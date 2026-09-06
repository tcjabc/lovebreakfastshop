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
Asia-Pacific/Tokyo region). Single table:

```sql
create table orders (
  id uuid primary key default gen\_random\_uuid(),
  short\_id text not null,
  items jsonb not null,
  total int not null,
  note text,
  status text not null default 'pending',
  created\_at timestamptz not null default now()
);
```

RLS is enabled with a permissive `allow all` policy (`using (true) with check (true)`) — fine for a single-shop app with no auth. If auth is
ever added (see Loyalty section below), tighten this.

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
* **`liff.getProfile()` now exists, but only behind a tester gate —
orders are still fully anonymous for everyone else.**
`maybeTesterLogin()` in `app.js` (called at the top of
`submitOrder()`) does `liff.isLoggedIn()` → `liff.login()` if
needed → `liff.getProfile()`, but only for a user `isTesterMode()`
(in `supabase-config.js`) says is a tester — everyone else's
checkout is untouched, no login prompt. This is a smoke test for
the login mechanics ahead of Loyalty (step 5 below); the resulting
profile isn't attached to the order yet (`orders` has no identity
column — see schema above).
* **The tester gate — `isTesterMode(userId)` in `supabase-config.js`
— is the ONLY place in the codebase that should ever decide "is
this user a tester."** Backed by a `feature_flags` table
(`line_user_id` primary key, `is_tester` boolean; see README.md →
"Feature flags (tester gating)" for the SQL/RLS). Toggling a tester
is a Supabase row edit, never a code change. When the login flow
ships for everyone, delete `isTesterMode()` and its one call site
in `maybeTesterLogin()` rather than leaving it in place unused.
* The LIFF channel's scopes only had `chat_message.write` enabled
(see README.md Step 3) — `profile` scope needs to be turned on in
the LINE Developers Console before `liff.getProfile()` will work for
anyone, tester or not. Not something this repo's code can do.
* Bootstrapping the very first tester is manual: `isTesterMode()` can
only recognize a LINE user id that's already been through
`liff.getProfile()` once, so seeding that first `feature_flags` row
needs the id obtained once outside this flow (e.g. a temporary
`console.log` during testing) — see README.md for the exact steps.

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

1. **Verify the hidden-bug fix** end-to-end: place a test order
locally, confirm the customer sees the real confirmation screen
(not stuck on it from page load), and a row lands in Supabase's
`orders` table.
2. **Deploy to Cloudflare Pages**, not Netlify — Netlify's free tier
tightened significantly in 2026 (now credit-based, \~15GB effective
bandwidth); Cloudflare Pages remains unmetered for static assets
and is the better free fit for this project.
3. **Create the real LIFF app** in the LINE Developers Console once a
real hosted URL exists, and swap the real `LIFF\_ID` into `app.js`.
4. **Tune `AVG\_MINUTES\_PER\_ITEM` / `QUEUE\_BUFFER\_MINUTES`** in
`supabase-config.js` once there's a week or two of real prep-time
data — current values are starting guesses.
5. **(Later) Loyalty system** — a first slice of this exists now,
tester-gated (see "LINE integration status" above):
`liff.login()`/`getProfile()` runs end-to-end at checkout, but only
for a user flagged in `feature_flags`, and the profile isn't
persisted anywhere yet. Still to do: a `members` table
(`line\_user\_id`, `points`, `total\_orders`) keyed to the LINE user
ID, auto-increment on order insert, a checkout-time
reward-application step, and — once the login flow is proven out —
removing the tester gate so it applies to everyone. Additive to the
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

