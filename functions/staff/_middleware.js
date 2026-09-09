// ============================================================
// PIN gate for the staff dashboard (/staff/*).
//
// Cloudflare Pages runs this middleware for every request under
// /staff before anything in that directory is served as a static
// file — so the real dashboard HTML/CSS/JS never reaches a browser
// unless a valid session cookie is already present, or a POST here
// supplies the correct PIN. There is no client-side login check to
// bypass by viewing source: an unauthenticated request never
// receives the dashboard markup in the first place.
//
// Requires two environment variables, set in the Cloudflare Pages
// dashboard (Settings -> Environment variables, for both Production
// and Preview) before this works — neither is read from anywhere
// else in this repo, and neither should ever be hardcoded or
// committed:
//   STAFF_DASHBOARD_PIN    — the PIN staff type in to open the
//                            dashboard at all.
//   STAFF_DASHBOARD_SECRET — a long random string used only to sign
//                            the session cookie's HMAC (e.g.
//                            `openssl rand -hex 32`). This is NOT the
//                            PIN itself — treat it like an API key.
//
// Deliberately NOT named STAFF_PIN: that name is already a Supabase
// Edge Function secret (see supabase/functions/_shared/verifyStaffPin.ts),
// gating a different, unrelated thing — the "會員儲值" top-up panel
// inside this same dashboard, checked via topup-stored-value and
// get-stored-value-balance-staff. Different platform (Supabase secrets
// vs. Cloudflare Pages env vars), so there'd be no actual technical
// collision, but reusing the name for two different gates would still
// invite exactly the mix-up these distinct names are meant to avoid.
// ============================================================

const COOKIE_NAME = "staff_session";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

async function hmacHex(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time string comparison. Deliberately avoids `===`/`==`,
// which short-circuits on the first differing character and can leak
// how many leading characters were guessed correctly via response
// timing. A length mismatch is folded into `diff` up front rather
// than returned early, so a wrong-length guess takes the same code
// path as any other wrong guess. Mirrors
// supabase/functions/_shared/verifyStaffPin.ts's helper of the same
// shape, kept separate here since Edge Functions and Pages Functions
// are different runtimes with no shared import path between them.
function timingSafeEqual(a, b) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length, 1);

  const aPadded = new Uint8Array(maxLen);
  const bPadded = new Uint8Array(maxLen);
  aPadded.set(aBytes);
  bPadded.set(bBytes);

  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= aPadded[i] ^ bPadded[i];
  }
  return diff === 0;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// A valid cookie is "<timestamp>.<hmac>" where hmac is
// HMAC-SHA256(timestamp, STAFF_DASHBOARD_SECRET) and timestamp is a
// Unix seconds value no more than 12 hours old (and not in the future).
async function isValidSession(cookieValue, secret) {
  if (!cookieValue || !secret) return false;
  const dot = cookieValue.indexOf(".");
  if (dot === -1) return false;

  const timestampStr = cookieValue.slice(0, dot);
  const suppliedHmac = cookieValue.slice(dot + 1);

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp)) return false;

  const ageSeconds = Date.now() / 1000 - timestamp;
  if (ageSeconds < 0 || ageSeconds > SESSION_MAX_AGE_SECONDS) return false;

  const expectedHmac = await hmacHex(timestampStr, secret);
  return timingSafeEqual(suppliedHmac, expectedHmac);
}

async function makeSessionCookieValue(secret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return `${timestamp}.${await hmacHex(timestamp, secret)}`;
}

function loginPageHtml(errorMessage) {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>員工登入</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #faf6f0;
    font-family: "Noto Sans TC", -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 24px;
  }
  .login-card {
    width: 100%;
    max-width: 340px;
    background: #fff;
    border-radius: 20px;
    padding: 32px 24px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
    text-align: center;
  }
  h1 {
    margin: 0 0 24px;
    font-size: 20px;
    font-weight: 700;
    color: #2b2b2b;
  }
  input[type="password"] {
    width: 100%;
    padding: 14px 16px;
    font-size: 18px;
    letter-spacing: 4px;
    text-align: center;
    border: 2px solid #e5ddd3;
    border-radius: 12px;
    margin-bottom: 16px;
    font-family: inherit;
  }
  input[type="password"]:focus {
    outline: none;
    border-color: #c0392b;
  }
  button {
    width: 100%;
    padding: 14px;
    font-size: 16px;
    font-weight: 700;
    color: #fff;
    background: #c0392b;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  button:active { opacity: 0.85; }
  .error {
    color: #c0392b;
    font-size: 14px;
    margin: -8px 0 16px;
  }
</style>
</head>
<body>
  <form class="login-card" method="POST" action="/staff/">
    <h1>員工登入</h1>
    ${errorMessage ? `<p class="error">${errorMessage}</p>` : ""}
    <input type="password" name="pin" inputmode="numeric" autocomplete="off" placeholder="請輸入PIN碼" autofocus />
    <button type="submit">登入</button>
  </form>
</body>
</html>`;
}

function htmlResponse(html, status) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  const sessionCookie = getCookie(request, COOKIE_NAME);
  if (await isValidSession(sessionCookie, env.STAFF_DASHBOARD_SECRET)) {
    return next();
  }

  const isLoginSubmit =
    request.method === "POST" &&
    (url.pathname === "/staff/" || url.pathname === "/staff");

  if (isLoginSubmit) {
    const formData = await request.formData();
    const submittedPin = String(formData.get("pin") || "");
    const correctPin = String(env.STAFF_DASHBOARD_PIN || "");

    if (submittedPin && timingSafeEqual(submittedPin, correctPin)) {
      const cookieValue = await makeSessionCookieValue(env.STAFF_DASHBOARD_SECRET);
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/staff/",
          "Set-Cookie": `${COOKIE_NAME}=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/staff`,
        },
      });
    }

    return htmlResponse(loginPageHtml("PIN 錯誤"), 401);
  }

  // No valid session and this isn't a login submission — respond with
  // the login form directly. Never call next() here: doing so would
  // serve the real dashboard HTML to an unauthenticated request.
  return htmlResponse(loginPageHtml(null), 200);
}
