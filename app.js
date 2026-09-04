// ============================================================
// APP LOGIC
// Replace LIFF_ID below with the ID you get from the LINE
// Developers Console (see README.md for the steps).
// ============================================================

const LIFF_ID = "PUT_YOUR_LIFF_ID_HERE"; // e.g. "1234567890-AbCdEfGh"

const cart = {}; // { itemId: quantity }

function findItem(id) {
  for (const cat of MENU) {
    const found = cat.items.find((i) => i.id === id);
    if (found) return found;
  }
  return null;
}

function renderMenu() {
  document.getElementById("shop-name").textContent = SHOP_INFO.name;
  document.getElementById("shop-note").textContent = SHOP_INFO.pickupNote;

  const list = document.getElementById("menu-list");
  list.innerHTML = "";

  MENU.forEach((category) => {
    const heading = document.createElement("div");
    heading.className = "category-title";
    heading.textContent = category.category;
    list.appendChild(heading);

    category.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "menu-item";
      row.innerHTML = `
        <div class="item-info">
          <div class="item-name">${item.name}</div>
          <div class="item-name-en">${item.nameEn}</div>
          <div class="item-price">NT$${item.price}</div>
        </div>
        <div class="stepper zero" id="stepper-${item.id}">
          <button class="decrement" aria-label="minus">−</button>
          <span class="qty">0</span>
          <button class="add-btn" aria-label="plus">＋</button>
        </div>
      `;
      list.appendChild(row);

      const stepper = row.querySelector(`#stepper-${item.id}`);
      stepper.querySelector(".add-btn").addEventListener("click", () => changeQty(item.id, 1));
      stepper.querySelector(".decrement").addEventListener("click", () => changeQty(item.id, -1));
    });
  });
}

function changeQty(id, delta) {
  const current = cart[id] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) delete cart[id];
  else cart[id] = next;

  const stepper = document.getElementById(`stepper-${id}`);
  stepper.querySelector(".qty").textContent = next;
  stepper.classList.toggle("zero", next === 0);

  updateCartBar();
}

function cartTotal() {
  return Object.entries(cart).reduce((sum, [id, qty]) => sum + findItem(id).price * qty, 0);
}

function cartCount() {
  return Object.values(cart).reduce((a, b) => a + b, 0);
}

function updateCartBar() {
  const bar = document.getElementById("cart-bar");
  const count = cartCount();
  if (count === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  document.getElementById("cart-count").textContent = `${count} 件`;
  document.getElementById("cart-total").textContent = `NT$${cartTotal()}`;
}

function openSheet() {
  const sheetItems = document.getElementById("sheet-items");
  sheetItems.innerHTML = "";
  Object.entries(cart).forEach(([id, qty]) => {
    const item = findItem(id);
    const row = document.createElement("div");
    row.className = "sheet-item-row";
    row.innerHTML = `<span>${item.name} × ${qty}</span><span>NT$${item.price * qty}</span>`;
    sheetItems.appendChild(row);
  });
  document.getElementById("sheet-total").textContent = `NT$${cartTotal()}`;
  document.getElementById("sheet-backdrop").hidden = false;
  document.getElementById("checkout-sheet").hidden = false;
}

function closeSheet() {
  document.getElementById("sheet-backdrop").hidden = true;
  document.getElementById("checkout-sheet").hidden = true;
}

function buildOrderMessage() {
  const lines = [`📋 新訂單 New Order`, ``];
  Object.entries(cart).forEach(([id, qty]) => {
    const item = findItem(id);
    lines.push(`${item.name} x${qty} — NT$${item.price * qty}`);
  });
  lines.push(``, `總計 Total: NT$${cartTotal()}`);

  const note = document.getElementById("order-note").value.trim();
  if (note) lines.push(``, `備註 Note: ${note}`);

  return lines.join("\n");
}

async function submitOrder() {
  const submitBtn = document.getElementById("submit-order");
  submitBtn.disabled = true;
  submitBtn.textContent = "送出中… Sending…";

  const orderItems = Object.entries(cart).map(([id, qty]) => {
    const item = findItem(id);
    return { id, name: item.name, qty, subtotal: item.price * qty };
  });
  const total = cartTotal();
  const itemCount = cartCount();
  const note = document.getElementById("order-note").value.trim();

  try {
    // 1. Save the order to Supabase — this is the source of truth for
    //    status tracking and printing at the shop.
    const saved = await insertOrder({ items: orderItems, total, note });

    // 2. Also drop a copy into the LINE chat so it's visible there too
    //    (optional — remove this block if you'd rather rely on the
    //    staff tablet only).
    if (liff.isInClient()) {
      const message = buildOrderMessage() + `\n訂單編號 Order #${saved.short_id}`;
      await liff.sendMessages([{ type: "text", text: message }]);
    }

    // 3. Estimate pickup time from current queue length
    const queueAhead = await getQueueCount();
    const waitMinutes = estimateWaitMinutes(itemCount, queueAhead - 1); // exclude the order just placed
    document.getElementById("confirm-wait").textContent =
      `預估取餐時間 Estimated pickup: ~${waitMinutes} 分鐘 min`;
    document.getElementById("confirm-order-id").textContent = `訂單編號 Order #${saved.short_id}`;

    closeSheet();
    Object.keys(cart).forEach((id) => delete cart[id]);
    document.getElementById("order-note").value = "";
    renderMenu();
    updateCartBar();
    document.getElementById("confirm-screen").hidden = false;
  } catch (err) {
    console.error(err);
    alert("送出失敗，請重試 Failed to send — please try again.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "送出訂單 Send order";
  }
}

function wireUpUI() {
  document.getElementById("cart-bar").addEventListener("click", openSheet);
  document.getElementById("close-sheet").addEventListener("click", closeSheet);
  document.getElementById("sheet-backdrop").addEventListener("click", closeSheet);
  document.getElementById("submit-order").addEventListener("click", submitOrder);
  document.getElementById("confirm-close").addEventListener("click", () => {
    document.getElementById("confirm-screen").hidden = true;
    if (liff.isInClient()) liff.closeWindow();
  });
}

async function init() {
  wireUpUI();
  renderMenu();

  try {
    await liff.init({ liffId: LIFF_ID });
  } catch (err) {
    console.error("LIFF init failed", err);
    // Menu still works for browser testing even if LIFF can't init
  }
}

init();
