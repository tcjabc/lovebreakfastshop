// ============================================================
// STAFF DASHBOARD LOGIC
// ============================================================

const POLL_INTERVAL_MS = 5000; // check for new/updated orders every 5s
let lastKnownIds = new Set();

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

  const itemsEl = card.querySelector(".order-items");
  order.items.forEach((item) => {
    const line = document.createElement("div");
    line.textContent = `${item.name} x${item.qty}`;
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

async function handlePrint(order) {
  try {
    await ThermalPrinter.printOrder({
      shopName: SHOP_INFO ? SHOP_INFO.name : "Order",
      shortId: order.short_id,
      items: order.items,
      total: order.total,
      note: order.note,
      time: formatTime(order.created_at),
    });
  } catch (err) {
    console.error(err);
    alert("列印失敗，請確認印表機已連接 Print failed — check printer connection.");
  }
}

async function refresh() {
  const orders = await fetchOrders();

  const columns = { pending: [], preparing: [], ready: [] };
  orders.forEach((o) => {
    if (columns[o.status]) columns[o.status].push(o);
  });

  ["pending", "preparing", "ready"].forEach((status) => {
    const container = document.getElementById(`col-${status}`);
    container.innerHTML = "";
    columns[status].forEach((order) => container.appendChild(buildCard(order)));
  });
}

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
