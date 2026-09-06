// ============================================================
// STAFF DASHBOARD LOGIC
// ============================================================

const POLL_INTERVAL_MS = 5000; // check for new/updated orders every 5s

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

async function fetchOrders() {
  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .in("status", ["pending", "preparing", "ready"])
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Fetch orders failed", error);
    return [];
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
    warn.title = "自動列印失敗，請按「列印」重試 Auto-print failed — retry with the Print button";
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
  printBtn.textContent = "🖨️ 列印 Print";
  printBtn.addEventListener("click", () => handlePrint(order));
  actions.appendChild(printBtn);

  const previewBtn = document.createElement("button");
  previewBtn.className = "action-btn print-btn";
  previewBtn.textContent = "👁️ 預覽 Preview";
  previewBtn.addEventListener("click", () => handlePreview(order));
  actions.appendChild(previewBtn);

  if (order.status === "pending") {
    const startBtn = document.createElement("button");
    startBtn.className = "action-btn primary-btn";
    startBtn.textContent = "開始製作 Start";
    startBtn.addEventListener("click", () => updateStatus(order.id, "preparing"));
    actions.appendChild(startBtn);
  } else if (order.status === "preparing") {
    const readyBtn = document.createElement("button");
    readyBtn.className = "action-btn primary-btn";
    readyBtn.textContent = "完成 Ready";
    readyBtn.addEventListener("click", () => updateStatus(order.id, "ready"));
    actions.appendChild(readyBtn);
  } else if (order.status === "ready") {
    const doneBtn = document.createElement("button");
    doneBtn.className = "action-btn primary-btn";
    doneBtn.textContent = "已取餐 Picked up";
    doneBtn.addEventListener("click", () => updateStatus(order.id, "completed"));
    actions.appendChild(doneBtn);
  }

  return card;
}

async function updateStatus(orderId, newStatus) {
  const { error } = await supabaseClient
    .from("orders")
    .update({ status: newStatus })
    .eq("id", orderId);

  if (error) {
    console.error("Status update failed", error);
    alert("更新失敗 Update failed");
    return;
  }
  refresh();
}

// Shape ThermalPrinter.printOrder()/buildReceiptPreview() both expect
// — shared so the preview can never drift from what actually prints.
function receiptDataFor(order) {
  return {
    shopName: SHOP_INFO ? SHOP_INFO.name : "Order",
    shortId: order.short_id,
    items: order.items,
    total: order.total,
    note: order.note,
    time: formatTime(order.created_at),
  };
}

async function markPrinted(order) {
  const { error } = await supabaseClient.from("orders").update({ printed: true }).eq("id", order.id);
  if (error) {
    // The physical print already happened at this point — logging
    // rather than surfacing an alert, since there's nothing actionable
    // for staff to do about a failed DB write. Worst case this order
    // gets auto-printed again next poll tick (printed is still false).
    console.error(`[Print] order #${order.short_id} printed but failed to mark printed=true:`, error);
  }
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
    await markPrinted(order);
    printFailed.delete(order.id);
    return true;
  } catch (err) {
    console.error(err);
    if (!silent) {
      alert("列印失敗，請確認印表機已連接 Print failed — check printer connection.");
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
  renderPreviewDoc(body, "🍳 Kitchen ticket", ThermalPrinter.buildKitchenTicketPreview(data));
  renderPreviewDoc(body, "🧾 Customer label", ThermalPrinter.buildCustomerLabelPreview(data));

  document.getElementById("receipt-preview-backdrop").hidden = false;
  document.getElementById("receipt-preview").hidden = false;
}

function closePreview() {
  document.getElementById("receipt-preview-backdrop").hidden = true;
  document.getElementById("receipt-preview").hidden = true;
}

async function refresh() {
  const orders = await fetchOrders();

  // Test orders (is_test = true, stamped by the tester-gated LIFF
  // login flow in app.js — see supabase-config.js's insertOrder())
  // never mix into the live kitchen queue or its auto-print sweep;
  // they render in their own section below instead. Split once here
  // rather than filtering in the DB query so both views come from the
  // same poll tick and can't drift out of sync with each other.
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

document.getElementById("staff-shop-name").textContent = SHOP_INFO ? SHOP_INFO.name : "Orders";

document.getElementById("receipt-preview-close").addEventListener("click", closePreview);
document.getElementById("receipt-preview-backdrop").addEventListener("click", closePreview);

document.getElementById("connect-printer-btn").addEventListener("click", async () => {
  try {
    await ThermalPrinter.connectPrinter();
    document.getElementById("connect-printer-btn").textContent = "✓ 印表機已連接 Printer connected";
  } catch (err) {
    console.error(err);
    alert("找不到印表機，請確認已用 USB 連接 Couldn't find printer — check the USB connection.");
  }
});

refresh();
setInterval(refresh, POLL_INTERVAL_MS);
