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

Open `menu.js` and edit the `MENU` array: category names, item names
(Chinese + English), and prices. No other file needs to change for a
menu update. Also update `SHOP_INFO.name` to the real shop name.

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
  created_at timestamptz not null default now()
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
