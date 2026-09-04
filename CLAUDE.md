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

* `LIFF\_ID` in `app.js` is still a placeholder
(`PUT\_YOUR\_LIFF\_ID\_HERE`) — a real LIFF app hasn't been created in
the LINE Developers Console yet. Until it is, LIFF-only features
(`liff.sendMessages()`, `liff.closeWindow()`) silently no-op — this
is intentional graceful degradation, not a bug (see `liff.isInClient()`
guards in `app.js`).
* No LINE Login / `liff.getProfile()` is used anywhere yet — orders
are fully anonymous, no customer identity is captured or required.

## Known-fixed bug (context for git history)

`style.css` originally set `display: flex` directly on `.cart-bar`
and `.confirm-screen`, which silently overrode the HTML `hidden`
attribute (a CSS specificity issue, not a JS bug) — the confirmation
overlay was visible on every page load regardless of order state.
Fixed by adding `\[hidden] { display: none }` overrides at the end of
`style.css`. If similar hidden/toggle bugs appear elsewhere, check for
this same pattern first.

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
5. **(Later) Loyalty system** — add `liff.login()` with `profile`
scope, a `members` table (`line\_user\_id`, `points`,
`total\_orders`) keyed to the LINE user ID, auto-increment on
order insert, and a checkout-time reward-application step. This is
additive to the existing schema, not a rebuild.

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

