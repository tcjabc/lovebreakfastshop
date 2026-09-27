// ============================================================
// STAFF DASHBOARD LOGIC
// ============================================================

const POLL_INTERVAL_MS = 5000; // check for new/updated orders every 5s

// ============================================================
// STAFF ACCOUNT (Supabase Auth)
//
// The dashboard signs in as the one Supabase Auth staff user, so its
// database requests carry the `authenticated` role (see
// supabase/sql/05_staff_policies.sql) instead of the public anon key.
// The Worker PIN gate on /staff/* (worker.js) stays the front door;
// this is the second layer.
//
// Its OWN client with its OWN auth storage key: the customer app runs
// on the same origin and uses supabase-config.js's default client, so
// sharing the default key would hand the staff session to any customer
// page opened in this browser. With a separate key the customer app
// never sees it.
//
// supabase-js persists the session in localStorage under this key and
// refreshes the access token automatically, so staff sign in once per
// device.
// ============================================================
const STAFF_AUTH_STORAGE_KEY = "lb-staff-auth";
const staffClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: STAFF_AUTH_STORAGE_KEY, persistSession: true, autoRefreshToken: true },
});

let pollTimer = null;

function showLogin(message) {
  stopPolling();
  clearOrderColumns(); // don't leave order data on screen once signed out
  document.getElementById("staff-dashboard").hidden = true;
  const msgEl = document.getElementById("staff-login-message");
  msgEl.textContent = message || "";
  msgEl.hidden = !message;
  document.getElementById("staff-login-error").hidden = true;
  document.getElementById("staff-login").hidden = false;
  document.getElementById("staff-login-email").focus();
}

function showDashboard() {
  document.getElementById("staff-login").hidden = true;
  document.getElementById("staff-dashboard").hidden = false;
}

function startPolling() {
  stopPolling();
  refresh();
  pollTimer = setInterval(refresh, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function clearOrderColumns() {
  ["col-pending", "col-preparing", "col-ready", "col-test"].forEach((id) => {
    document.getElementById(id).innerHTML = "";
  });
  document.getElementById("test-orders-section").hidden = true;
}

// Checked before every poll and every write. RLS denials are SILENT
// (a signed-out SELECT just returns no rows; an UPDATE matches 0 rows),
// so without this an expired session would look like an empty queue.
// getSession() refreshes an expired access token itself; if that fails
// the session comes back null. Returns true if it's safe to proceed.
async function ensureStaffSession() {
  const { data, error } = await staffClient.auth.getSession();
  if (error || !data.session) {
    if (error) console.error("[StaffAuth] session check failed", error);
    showLogin("登入已失效，請重新登入。");
    return false;
  }
  return true;
}

function loginErrorMessage(error) {
  const code = error && (error.code || "");
  const msg = ((error && error.message) || "").toLowerCase();
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "電子郵件或密碼錯誤";
  if (code === "email_not_confirmed") return "此帳號尚未完成驗證";
  if (code === "over_request_rate_limit" || error.status === 429) return "嘗試次數過多，請稍後再試";
  if (msg.includes("fetch") || msg.includes("network")) return "無法連線，請檢查網路後再試";
  return "登入失敗，請稍後再試";
}

async function handleStaffLogin(e) {
  e.preventDefault();
  const email = document.getElementById("staff-login-email").value.trim();
  const passwordEl = document.getElementById("staff-login-password");
  const errorEl = document.getElementById("staff-login-error");
  const submitBtn = document.getElementById("staff-login-submit");
  errorEl.hidden = true;

  if (!email || !passwordEl.value) {
    errorEl.textContent = "請輸入電子郵件和密碼";
    errorEl.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "登入中…";
  try {
    const { error } = await staffClient.auth.signInWithPassword({ email, password: passwordEl.value });
    if (error) {
      console.error("[StaffAuth] sign-in failed", error);
      errorEl.textContent = loginErrorMessage(error);
      errorEl.hidden = false;
      return;
    }
    passwordEl.value = "";
    showDashboard();
    startPolling();
  } catch (err) {
    console.error("[StaffAuth] sign-in threw", err);
    errorEl.textContent = loginErrorMessage(err);
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "登入";
  }
}

async function handleStaffSignOut() {
  if (!confirm("確定要登出嗎？登出後需重新輸入帳號密碼。")) return;
  // scope "local": sign out THIS device only. The shop has one shared
  // staff account, so the default ("global") would also sign out every
  // other tablet using it.
  const { error } = await staffClient.auth.signOut({ scope: "local" });
  if (error) console.error("[StaffAuth] sign-out failed", error);
  showLogin("已登出。");
}

// Shop info from /menu.json (the dashboard only needs shopInfo — orders
// carry their own item names/prices). null until loadShopInfo()
// resolves, or if it failed; the order queue works either way.
let SHOP_INFO = null;
// Receipt header when shopInfo didn't load — a literal, not read from
// menu.json, precisely because it's only used when that fetch failed.
// Every character is in print.js's GB18030_TABLE.
const RECEIPT_FALLBACK_SHOP_NAME = "樂福早餐店";

async function loadShopInfo() {
  const nameEl = document.getElementById("staff-shop-name");
  try {
    const res = await fetch("/menu.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`menu.json HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.shopInfo) throw new Error("menu.json has no shopInfo");
    SHOP_INFO = data.shopInfo;
    nameEl.textContent = SHOP_INFO.name;
  } catch (err) {
    console.error("[Menu] failed to load menu.json", err);
    nameEl.textContent = "菜單載入失敗，請重新整理";
  }
}

// Auto-print bookkeeping — both in-memory only (session-scoped, not
// persisted). Whether an order has actually been printed lives in
// Supabase (orders.printed) precisely so *that* survives a reload;
// these two only need to survive within one page session:
//   - printingInFlight: guards against a slow print still running
//     when the next poll tick fires, before its printed=true update
//     has landed in Supabase.
//   - printFailed: once an order's auto-print attempt fails, stop
//     retrying it automatically every poll tick (which would hammer a
//     disconnected/broken printer) — staff retry via the manual Print
//     button instead, which isn't gated by this set.
const printingInFlight = new Set();
const printFailed = new Set();
// Set once marking an order printed fails. Auto-print then stops for the
// rest of this page session: the physical print already happened, and
// with printed still false the next poll would print it again, forever.
let autoPrintHalted = false;

// null on error (as opposed to [] = genuinely no open orders), so a
// failed fetch never wipes the columns and looks like an empty queue.
async function fetchOrders() {
  const { data, error } = await staffClient
    .from("orders")
    .select("*")
    .in("status", ["pending", "preparing", "ready"])
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Fetch orders failed", error);
    return null;
  }
  return data;
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

function buildCard(order) {
  const template = document.getElementById("order-card-template");
  const card = template.content.firstElementChild.cloneNode(true);

  card.querySelector(".order-id").textContent = `#${order.short_id}`;
  card.querySelector(".order-time").textContent = formatTime(order.created_at);

  if (printFailed.has(order.id)) {
    const warn = document.createElement("span");
    warn.className = "print-warning";
    warn.title = "自動列印失敗，請按「列印」重試";
    warn.textContent = "⚠️";
    // .order-card-top is a space-between flex row of exactly
    // [order-id, order-time] — insert right after order-id specifically
    // (not appendChild, which would land after order-time instead).
    card.querySelector(".order-id").after(warn);
  }

  const itemsEl = card.querySelector(".order-items");
  order.items.forEach((item) => {
    const line = document.createElement("div");
    line.textContent = item.modifiers
      ? `${item.name}（${item.modifiers}）x${item.qty}`
      : `${item.name} x${item.qty}`;
    itemsEl.appendChild(line);
  });

  const noteEl = card.querySelector(".order-note");
  if (order.note) {
    noteEl.textContent = `備註: ${order.note}`;
  } else {
    noteEl.remove();
  }

  card.querySelector(".order-total").textContent = `NT$${order.total}`;

  const actions = card.querySelector(".order-actions");

  const printBtn = document.createElement("button");
  printBtn.className = "action-btn print-btn";
  printBtn.textContent = "🖨️ 列印";
  printBtn.addEventListener("click", () => handlePrint(order));
  actions.appendChild(printBtn);

  const previewBtn = document.createElement("button");
  previewBtn.className = "action-btn print-btn";
  previewBtn.textContent = "👁️ 預覽";
  previewBtn.addEventListener("click", () => handlePreview(order));
  actions.appendChild(previewBtn);

  if (order.status === "pending") {
    const startBtn = document.createElement("button");
    startBtn.className = "action-btn primary-btn";
    startBtn.textContent = "開始製作";
    startBtn.addEventListener("click", () => updateStatus(order.id, "preparing"));
    actions.appendChild(startBtn);
  } else if (order.status === "preparing") {
    const readyBtn = document.createElement("button");
    readyBtn.className = "action-btn primary-btn";
    readyBtn.textContent = "完成";
    readyBtn.addEventListener("click", () => updateStatus(order.id, "ready"));
    actions.appendChild(readyBtn);
  } else if (order.status === "ready") {
    const doneBtn = document.createElement("button");
    doneBtn.className = "action-btn primary-btn";
    doneBtn.textContent = "已取餐";
    doneBtn.addEventListener("click", () => updateStatus(order.id, "completed"));
    actions.appendChild(doneBtn);
  }

  return card;
}

// Updates one order and asks for the row back. An UPDATE that RLS
// doesn't allow isn't an error — it just matches 0 rows — so "no row
// came back" is treated as a failure too; a permissions problem must
// never look like success. Returns true only if the row really changed.
async function updateOrderRow(orderId, changes) {
  const { data, error } = await staffClient.from("orders").update(changes).eq("id", orderId).select("id");
  if (error) {
    console.error("[Orders] update failed", changes, error);
    return false;
  }
  if (!data || data.length === 0) {
    console.error("[Orders] update matched 0 rows (no permission, or the order no longer exists)", orderId, changes);
    return false;
  }
  return true;
}

async function updateStatus(orderId, newStatus) {
  if (!(await ensureStaffSession())) return;
  const ok = await updateOrderRow(orderId, { status: newStatus });
  if (!ok) {
    alert("更新失敗：訂單狀態沒有變更。可能是登入已失效或沒有權限，請重新整理頁面後再試。");
    return;
  }
  refresh();
}

// Shape ThermalPrinter.printOrder()/buildReceiptPreview() both expect
// — shared so the preview can never drift from what actually prints.
function receiptDataFor(order) {
  return {
    shopName: SHOP_INFO ? SHOP_INFO.name : RECEIPT_FALLBACK_SHOP_NAME,
    shortId: order.short_id,
    items: order.items,
    total: order.total,
    note: order.note,
    time: formatTime(order.created_at),
    paymentMethod: order.payment_method,
    stampDiscount: order.stamp_discount,
    pickupSlot: order.pickup_slot,
    memberName: order.member_name,
    stampSnapshot: order.stamp_snapshot,
    balanceSnapshot: order.balance_snapshot,
  };
}

// Returns whether printed=true actually landed (see updateOrderRow()).
async function markPrinted(order) {
  return updateOrderRow(order.id, { printed: true });
}

// The physical print happened but printed=true didn't stick. Left alone,
// the next poll would see printed=false and print it again every 5s — so
// stop auto-print entirely (until reload), say so on screen, and alert
// once. Manual 列印 still works.
function haltAutoPrint(order) {
  printFailed.add(order.id); // this order also shows the ⚠️ icon
  document.getElementById("autoprint-halted-banner").hidden = false;
  if (autoPrintHalted) return;
  autoPrintHalted = true;
  alert(
    `訂單 #${order.short_id} 已列印，但無法標記為「已列印」（可能是登入已失效或沒有權限）。\n` +
      "為避免重複列印，自動列印已暫停。請重新整理頁面，若仍發生請重新登入。"
  );
}

// Shared by the manual Print button and the auto-print sweep below —
// the only difference is whether a failure shows a blocking alert()
// (fine for a direct button click; would be disruptive popping up
// unprompted from a background poll tick, where the on-card warning
// icon is the right amount of visible instead). Returns whether the
// print actually succeeded, so callers can react (mark printed, flag
// the warning icon) without duplicating the try/catch.
//
// ThermalPrinter.printOrder() sends both the kitchen ticket and the
// customer label (in that order) before resolving, and throws if
// either transferOut fails — so markPrinted() below only ever fires
// once both documents have gone out successfully, not after just one.
async function handlePrint(order, { silent = false } = {}) {
  try {
    await ThermalPrinter.printOrder(receiptDataFor(order));
    if (!(await markPrinted(order))) {
      haltAutoPrint(order); // alerts even when silent — this one needs a human
      return false;
    }
    printFailed.delete(order.id);
    return true;
  } catch (err) {
    console.error(err);
    if (!silent) {
      alert("列印失敗，請確認印表機已連接");
    }
    return false;
  }
}

// Auto-print: called every refresh() with the latest orders. For each
// pending order not yet printed (and not already mid-print / already
// failed this session), silently reconnects to the printer via
// ThermalPrinter's getDevices()-based path (see print.js) and prints
// it through the exact same handlePrint() the manual button uses.
function autoPrintPendingOrders(orders) {
  if (autoPrintHalted) return; // see haltAutoPrint()
  orders
    .filter(
      (order) =>
        order.status === "pending" &&
        !order.printed &&
        !printingInFlight.has(order.id) &&
        !printFailed.has(order.id)
    )
    .forEach(async (order) => {
      printingInFlight.add(order.id);
      console.log(`[AutoPrint] new unprinted pending order detected: #${order.short_id}`);
      console.log(`[AutoPrint] calling handlePrint for #${order.short_id}`);
      const ok = await handlePrint(order, { silent: true });
      if (ok) {
        console.log(`[AutoPrint] #${order.short_id} printed successfully, marked printed=true`);
      } else {
        console.error(`[AutoPrint] #${order.short_id} failed to print — will not auto-retry this session`);
        printFailed.add(order.id);
      }
      printingInFlight.delete(order.id);
      refresh(); // reflect the printed order / warning icon right away instead of waiting for the next poll tick
    });
}

// Renders the exact same {text, align, bold, size} lines print.js
// would send to the printer, as plain HTML — lets spacing/alignment
// changes in print.js be checked on screen without a physical test
// print. Two documents now print per order (kitchen ticket, customer
// label); the preview shows both, in the same order they'll print, so
// it can't drift from what printOrder() actually sends.
function renderPreviewDoc(container, title, lines) {
  const heading = document.createElement("div");
  heading.className = "receipt-preview-doc-title";
  heading.textContent = title;
  container.appendChild(heading);

  lines.forEach((line) => {
    const div = document.createElement("div");
    div.className = "receipt-preview-line";
    if (line.align === "center") div.classList.add("center");
    if (line.bold) div.classList.add("bold");
    if (line.size === "large") div.classList.add("large");
    div.textContent = line.text;
    container.appendChild(div);
  });
}

function handlePreview(order) {
  const data = receiptDataFor(order);

  const body = document.getElementById("receipt-preview-body");
  body.style.width = `${ThermalPrinter.CHARS_PER_LINE}ch`;
  body.innerHTML = "";
  renderPreviewDoc(body, "🍳 廚房單", ThermalPrinter.buildKitchenTicketPreview(data));
  renderPreviewDoc(body, "🧾 顧客收據", ThermalPrinter.buildCustomerLabelPreview(data));

  document.getElementById("receipt-preview-backdrop").hidden = false;
  document.getElementById("receipt-preview").hidden = false;
}

function closePreview() {
  document.getElementById("receipt-preview-backdrop").hidden = true;
  document.getElementById("receipt-preview").hidden = true;
}

async function refresh() {
  if (!(await ensureStaffSession())) return; // signed out / refresh failed → sign-in screen, polling stopped
  const orders = await fetchOrders();
  if (orders === null) return; // fetch failed — keep the last good render rather than showing an empty queue

  // Test orders (is_test = true — decided server-side by place-order
  // from feature_flags for the verified LINE user) never mix into the live
  // kitchen queue or its auto-print sweep; they render in their own
  // section below instead. Split once here rather than filtering in
  // the DB query so both views come from the same poll tick and can't
  // drift out of sync with each other.
  const liveOrders = orders.filter((o) => !o.is_test);
  const testOrders = orders.filter((o) => o.is_test);

  const columns = { pending: [], preparing: [], ready: [] };
  liveOrders.forEach((o) => {
    if (columns[o.status]) columns[o.status].push(o);
  });

  ["pending", "preparing", "ready"].forEach((status) => {
    const container = document.getElementById(`col-${status}`);
    container.innerHTML = "";
    columns[status].forEach((order) => container.appendChild(buildCard(order)));
  });

  const testContainer = document.getElementById("col-test");
  testContainer.innerHTML = "";
  testOrders.forEach((order) => testContainer.appendChild(buildCard(order)));
  // Only take up screen space when there's actually something to
  // check — see the [hidden]-vs-CSS-display note in CLAUDE.md before
  // giving .test-orders-section an unconditional `display` anywhere.
  document.getElementById("test-orders-section").hidden = testOrders.length === 0;

  autoPrintPendingOrders(liveOrders); // test orders are never auto-printed
}

document.getElementById("receipt-preview-close").addEventListener("click", closePreview);
document.getElementById("receipt-preview-backdrop").addEventListener("click", closePreview);

document.getElementById("connect-printer-btn").addEventListener("click", async () => {
  try {
    await ThermalPrinter.connectPrinter();
    document.getElementById("connect-printer-btn").textContent = "✓ 印表機已連接";
  } catch (err) {
    console.error(err);
    alert("找不到印表機，請確認已用 USB 連接");
  }
});

// ============================================================
// 會員儲值 (Stored Value) — staff-only search → confirm → top-up flow.
// Search reads `members` directly via the signed-in staffClient
// (authenticated SELECT policy, see 05_staff_policies.sql). Balance lookups and
// the actual top-up both go through PIN-gated Edge Functions
// (get-stored-value-balance-staff / topup-stored-value) — staff have
// no LINE identity of their own to verify, unlike the customer-facing
// balance/spend functions, which verify a LIFF ID token instead.
// ============================================================

const EDGE_FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

let currentSvMember = null; // the member row selected in the search results, or null
let svSearchDebounce = null;

// Uniformly returns { ok, code?, error?, ... } whether the Edge
// Function itself responded (any status — its JSON body is always
// this shape, see supabase/functions/*/index.ts) or the request never
// completed at all (offline, DNS, malformed response body). Callers
// branch on `.code` the same way regardless of which case it was —
// only the "network" code is synthesized here rather than coming from
// the function itself.
async function callStoredValueFunction(name, payload) {
  try {
    const res = await fetch(`${EDGE_FUNCTIONS_BASE}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    try {
      return await res.json();
    } catch {
      return { ok: false, code: "network", error: "伺服器回應格式錯誤" };
    }
  } catch (err) {
    console.error(`[StoredValue] ${name} request failed`, err);
    return { ok: false, code: "network", error: "網路連線失敗" };
  }
}

function showSvError(kind, message) {
  const el = document.getElementById("sv-error");
  el.className = `sv-error ${kind}`; // "pin" or "generic" — see staff-style.css for how these read differently
  el.textContent = message;
  el.hidden = false;
}

function hideSvError() {
  document.getElementById("sv-error").hidden = true;
}

// Switches the panel between its three sub-views and keeps the header
// (title text, back button) in sync — the only place either changes,
// so a view and its header can't drift apart.
function showSvView(view) {
  document.getElementById("sv-search-view").hidden = view !== "search";
  document.getElementById("sv-confirm-view").hidden = view !== "confirm";
  document.getElementById("sv-success-view").hidden = view !== "success";

  const back = document.getElementById("sv-back");
  const close = document.getElementById("sv-close");
  const title = document.getElementById("sv-panel-title");

  if (view === "search") {
    title.textContent = "會員儲值";
    back.classList.add("sv-back-inactive");
    close.hidden = false;
  } else if (view === "confirm") {
    title.textContent = "確認儲值對象";
    back.classList.remove("sv-back-inactive");
    close.hidden = false;
  } else {
    title.textContent = "儲值成功";
    back.classList.add("sv-back-inactive");
    close.hidden = true; // success only closes via 完成 — one path back to a reset state, not two
  }
}

function resetStoredValueState() {
  currentSvMember = null;
  document.getElementById("sv-search-input").value = "";
  document.getElementById("sv-results").innerHTML = "";
  document.getElementById("sv-pin-input").value = "";
  document.getElementById("sv-amount-input").value = "";
  document.getElementById("sv-balance-row").textContent = "輸入PIN碼即可查詢餘額";
  hideSvError();
  showSvView("search");
}

function openStoredValuePanel() {
  resetStoredValueState(); // always open on a clean slate, never whatever a previous use left behind
  document.getElementById("sv-backdrop").hidden = false;
  document.getElementById("sv-panel").hidden = false;
  document.getElementById("sv-search-input").focus();
}

// The one path back to closed, from ✕, the backdrop, or 完成 alike —
// always resets state, so nothing about a finished or abandoned
// attempt (search text, selected member, amount, PIN) lingers into
// the next time staff opens this panel.
function closeStoredValuePanel() {
  document.getElementById("sv-backdrop").hidden = true;
  document.getElementById("sv-panel").hidden = true;
  resetStoredValueState();
}

function formatLastSeen(isoString) {
  if (!isoString) return "尚無使用紀錄";
  const d = new Date(isoString);
  return `最近使用：${d.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function renderSvResults(members) {
  const resultsEl = document.getElementById("sv-results");
  resultsEl.innerHTML = "";

  if (!members || members.length === 0) {
    const note = document.createElement("div");
    note.className = "sv-empty-note";
    note.textContent = "找不到符合的會員";
    resultsEl.appendChild(note);
    return;
  }

  members.forEach((member) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sv-result-row";

    if (member.picture_url) {
      const img = document.createElement("img");
      img.className = "sv-result-photo";
      img.src = member.picture_url;
      img.alt = "";
      row.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "sv-avatar-placeholder";
      row.appendChild(placeholder);
    }

    const info = document.createElement("div");
    info.className = "sv-result-info";

    const name = document.createElement("div");
    name.className = "sv-result-name";
    name.textContent = member.display_name || "（未命名會員）";
    info.appendChild(name);

    const lastSeen = document.createElement("div");
    lastSeen.className = "sv-result-last-seen";
    lastSeen.textContent = formatLastSeen(member.last_seen_at);
    info.appendChild(lastSeen);

    row.appendChild(info);
    row.addEventListener("click", () => selectMember(member));
    resultsEl.appendChild(row);
  });
}

async function searchMembers(query) {
  if (!(await ensureStaffSession())) return;
  const { data, error } = await staffClient
    .from("members")
    .select("user_id,display_name,picture_url,last_seen_at")
    .ilike("display_name", `%${query}%`)
    .order("last_seen_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[StoredValue] member search failed", error);
    const resultsEl = document.getElementById("sv-results");
    resultsEl.innerHTML = "";
    const note = document.createElement("div");
    note.className = "sv-empty-note";
    note.textContent = "搜尋失敗，請稍後再試";
    resultsEl.appendChild(note);
    return;
  }

  renderSvResults(data);
}

// Photo + name shown prominently is the safety net against crediting
// the wrong person when multiple search results come back — see the
// panel's aria-label / the comment above the markup in staff/index.html.
function selectMember(member) {
  currentSvMember = member;
  document.getElementById("sv-pin-input").value = "";
  document.getElementById("sv-amount-input").value = "";
  document.getElementById("sv-balance-row").textContent = "輸入PIN碼即可查詢餘額";
  hideSvError();

  const photo = document.getElementById("sv-member-photo");
  const placeholder = document.getElementById("sv-member-photo-placeholder");
  if (member.picture_url) {
    photo.src = member.picture_url;
    photo.hidden = false;
    placeholder.hidden = true;
  } else {
    photo.hidden = true;
    placeholder.hidden = false;
  }
  document.getElementById("sv-member-name").textContent = member.display_name || "（未命名會員）";

  showSvView("confirm");
  document.getElementById("sv-pin-input").focus();
}

// Fired on PIN blur/Enter rather than every keystroke — this is a
// balance *lookup*, no reason to hit the function on every character
// typed. Reuses whatever PIN ends up in the field for the eventual
// 確認儲值 submit too, so staff only ever type it once.
async function fetchStaffBalance() {
  if (!currentSvMember) return;
  const pin = document.getElementById("sv-pin-input").value.trim();
  const balanceRow = document.getElementById("sv-balance-row");
  if (!pin) {
    balanceRow.textContent = "輸入PIN碼即可查詢餘額";
    return;
  }

  balanceRow.textContent = "查詢中…";
  const result = await callStoredValueFunction("get-stored-value-balance-staff", {
    pin,
    user_id: currentSvMember.user_id,
  });

  if (result.ok) {
    balanceRow.textContent = `目前餘額：NT$${result.balance}`;
  } else if (result.code === "invalid_pin") {
    balanceRow.textContent = "PIN碼錯誤，無法查詢餘額";
  } else {
    balanceRow.textContent = "餘額查詢失敗，請稍後再試";
  }
}

// Wrong PIN and a genuine network/unexpected failure are deliberately
// shown as visually distinct states (see .sv-error.pin vs
// .sv-error.generic in staff-style.css) — a PIN typo shouldn't read as
// "something's broken," and a real failure shouldn't read as "you
// mistyped it," so staff know which one to actually act on.
async function submitTopup() {
  if (!currentSvMember) return;

  const pin = document.getElementById("sv-pin-input").value.trim();
  const rawAmount = document.getElementById("sv-amount-input").value.trim();
  const amount = Number(rawAmount);

  hideSvError();

  if (!pin) {
    showSvError("generic", "請輸入PIN碼");
    return;
  }
  if (!rawAmount || !Number.isInteger(amount) || amount <= 0) {
    showSvError("generic", "請輸入正確的儲值金額");
    return;
  }

  const submitBtn = document.getElementById("sv-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "處理中…";

  const result = await callStoredValueFunction("topup-stored-value", {
    pin,
    user_id: currentSvMember.user_id,
    amount,
  });

  submitBtn.disabled = false;
  submitBtn.textContent = "確認儲值";

  if (result.ok) {
    document.getElementById(
      "sv-success-message"
    ).textContent = `${currentSvMember.display_name} 儲值成功，新餘額為 NT$${result.balance}`;
    showSvView("success");
    return;
  }

  if (result.code === "invalid_pin") {
    showSvError("pin", "PIN碼錯誤");
  } else {
    showSvError("generic", "⚠️ 發生錯誤，請稍後再試");
  }
}

document.getElementById("stored-value-btn").addEventListener("click", openStoredValuePanel);
document.getElementById("sv-close").addEventListener("click", closeStoredValuePanel);
document.getElementById("sv-backdrop").addEventListener("click", closeStoredValuePanel);
document.getElementById("sv-back").addEventListener("click", () => showSvView("search"));
document.getElementById("sv-done").addEventListener("click", closeStoredValuePanel);
document.getElementById("sv-submit").addEventListener("click", submitTopup);

document.getElementById("sv-pin-input").addEventListener("blur", fetchStaffBalance);
document.getElementById("sv-pin-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    fetchStaffBalance();
  }
});

document.getElementById("sv-search-input").addEventListener("input", (e) => {
  clearTimeout(svSearchDebounce);
  const query = e.target.value.trim();
  if (!query) {
    document.getElementById("sv-results").innerHTML = "";
    return;
  }
  svSearchDebounce = setTimeout(() => searchMembers(query), 300);
});

document.getElementById("staff-login-form").addEventListener("submit", handleStaffLogin);
document.getElementById("staff-signout-btn").addEventListener("click", handleStaffSignOut);

// A session that disappears in the background (refresh token revoked,
// signed out in another tab of this browser) goes straight back to the
// sign-in screen instead of waiting for the next poll to notice.
staffClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && !document.getElementById("staff-dashboard").hidden) {
    showLogin("登入已失效，請重新登入。");
  }
});

// Shop info first, so the first auto-print sweep already has the shop
// name for the receipt header (loadShopInfo() never rejects). Then: a
// stored, still-valid session → dashboard + polling; none → sign-in.
// Polling only ever starts once signed in.
loadShopInfo().then(async () => {
  const { data } = await staffClient.auth.getSession();
  if (data.session) {
    showDashboard();
    startPolling();
  } else {
    showLogin();
  }
});
