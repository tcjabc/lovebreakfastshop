// ============================================================
// APP LOGIC
// Replace LIFF_ID below with the ID you get from the LINE
// Developers Console (see README.md for the steps).
// ============================================================

const LIFF_ID = "PUT_YOUR_LIFF_ID_HERE"; // e.g. "1234567890-AbCdEfGh"

// cart is keyed by a "line id", not a plain item id — an item ordered
// twice with two different customizations needs two separate lines
// (different price, different note to the kitchen), while a plain
// item with no options keeps line id === item id, exactly like
// before. See lineId() below.
// { [lineId]: { itemId, qty, selection } }
const cart = {};

// Holds the item + in-progress selection while the options sheet is
// open. Not part of `cart` until "Add to cart" is pressed.
let activeOptionsItem = null;
let currentSelection = null;
let currentOptionsQty = 1;

function findItem(id) {
  for (const cat of MENU) {
    const found = cat.items.find((i) => i.id === id);
    if (found) return found;
  }
  return null;
}

function itemHasOptions(item) {
  return !!(
    (item.modifierGroups && item.modifierGroups.length) ||
    (item.addons && item.addons.length) ||
    item.priceThin != null ||
    item.priceThick != null
  );
}

// ------------------------------------------------------------
// Pricing / description helpers — the single source of truth for
// "what does this line cost" and "what did the customer pick",
// shared by the cart bar, checkout sheet, order message, and the
// order record saved to Supabase.
// ------------------------------------------------------------

function lineBasePrice(item, selection) {
  if (item.priceThin != null || item.priceThick != null) {
    return selection && selection.thickness === "thick" ? item.priceThick : item.priceThin;
  }
  return item.price;
}

function lineUnitPrice(item, selection) {
  let total = lineBasePrice(item, selection);
  if (!selection) return total;

  (item.modifierGroups || []).forEach((groupId) => {
    const group = modifierGroups[groupId];
    const picked = selection.groups[groupId];
    if (group.type === "multi") {
      (picked || []).forEach((i) => (total += group.options[i].price));
    } else {
      const i = picked != null ? picked : 0;
      total += group.options[i].price;
    }
  });

  (item.addons || []).forEach((addon, i) => {
    if ((selection.addons || []).includes(i)) total += addon.price;
  });

  return total;
}

// Human-readable summary of a selection, e.g. "厚片、+起司、+荷包蛋" —
// used in the cart sheet, the LINE chat message, and the order saved
// to Supabase so staff can see exactly what to make.
function describeSelection(item, selection) {
  if (!selection) return "";
  const parts = [];

  if (item.priceThick != null) {
    parts.push(selection.thickness === "thick" ? "厚片" : "吐司");
  }

  (item.modifierGroups || []).forEach((groupId) => {
    const group = modifierGroups[groupId];
    const picked = selection.groups[groupId];
    if (group.type === "multi") {
      (picked || []).forEach((i) => parts.push(`+${group.options[i].label}`));
    } else {
      const i = picked != null ? picked : 0;
      // Only call out the choice when it's not the plain first option —
      // e.g. "抓餅" is worth showing, "原味" isn't.
      if (i !== 0) parts.push(group.options[i].label);
    }
  });

  (item.addons || []).forEach((addon, i) => {
    if ((selection.addons || []).includes(i)) parts.push(`+${addon.label}`);
  });

  return parts.join("、");
}

// Deterministic id for a (item, selection) pair so re-adding the same
// exact customization merges into the same cart line instead of
// creating a duplicate.
function lineId(itemId, selection) {
  if (!selection) return itemId;
  const groups = {};
  Object.keys(selection.groups || {})
    .sort()
    .forEach((groupId) => {
      const v = selection.groups[groupId];
      groups[groupId] = Array.isArray(v) ? [...v].sort((a, b) => a - b) : v;
    });
  const addons = [...(selection.addons || [])].sort((a, b) => a - b);
  return `${itemId}::${JSON.stringify({ t: selection.thickness || null, g: groups, a: addons })}`;
}

// ------------------------------------------------------------
// Menu rendering
// ------------------------------------------------------------

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
      const hasOptions = itemHasOptions(item);
      const priceLabel = item.priceThin != null
        ? `NT$${item.priceThin}${item.priceThick != null ? "起" : ""}`
        : `NT$${item.price}`;

      const row = document.createElement("div");
      row.className = "menu-item";
      row.innerHTML = `
        <div class="item-info">
          <div class="item-name">${item.name}</div>
          <div class="item-name-en">${item.nameEn}</div>
          <div class="item-price">${priceLabel}</div>
          ${hasOptions ? `<div class="item-customize-hint">可客製化 Customizable</div>` : ""}
        </div>
        <div class="stepper zero" id="stepper-${item.id}">
          ${hasOptions ? "" : `<button class="decrement" aria-label="minus">−</button><span class="qty">0</span>`}
          <button class="add-btn" aria-label="${hasOptions ? "customize" : "plus"}">＋</button>
        </div>
      `;
      list.appendChild(row);

      const stepper = row.querySelector(`#stepper-${item.id}`);
      if (hasOptions) {
        stepper.classList.remove("zero"); // no qty/decrement to hide — always just the + button
        stepper.querySelector(".add-btn").addEventListener("click", () => openOptionsSheet(item));
      } else {
        stepper.querySelector(".add-btn").addEventListener("click", () => changeQty(item.id, 1));
        stepper.querySelector(".decrement").addEventListener("click", () => changeQty(item.id, -1));
      }
    });
  });
}

// Plain (no-options) items only — items with options are added via
// the options sheet's "Add to cart" instead (see confirmAddOptions).
function changeQty(id, delta) {
  const current = (cart[id] && cart[id].qty) || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) delete cart[id];
  else cart[id] = { itemId: id, qty: next, selection: null };

  const stepper = document.getElementById(`stepper-${id}`);
  stepper.querySelector(".qty").textContent = next;
  stepper.classList.toggle("zero", next === 0);

  updateCartBar();
}

function cartTotal() {
  return Object.values(cart).reduce((sum, line) => {
    const item = findItem(line.itemId);
    return sum + lineUnitPrice(item, line.selection) * line.qty;
  }, 0);
}

function cartCount() {
  return Object.values(cart).reduce((sum, line) => sum + line.qty, 0);
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

// ------------------------------------------------------------
// Item customization sheet (checkboxes for multi groups, radio
// buttons for single groups) — reuses the same sheet/backdrop and
// button styling as the checkout sheet.
// ------------------------------------------------------------

function buildOptionGroup({ title, name, type, options, isSelected, onSelect }) {
  const wrap = document.createElement("div");
  wrap.className = "option-group";

  const heading = document.createElement("div");
  heading.className = "option-group-title";
  heading.textContent = title;
  wrap.appendChild(heading);

  options.forEach((opt) => {
    const row = document.createElement("label");
    row.className = "option-row";

    const input = document.createElement("input");
    input.type = type === "multi" ? "checkbox" : "radio";
    input.name = name;
    input.checked = isSelected(opt.value);
    input.addEventListener("change", () => {
      onSelect(opt.value);
      renderOptionsContent(); // re-render so checked state / subtotal stay in sync
    });

    const span = document.createElement("span");
    span.textContent = opt.label;

    row.appendChild(input);
    row.appendChild(span);
    wrap.appendChild(row);
  });

  return wrap;
}

function renderOptionsContent() {
  const item = activeOptionsItem;
  const container = document.getElementById("options-content");
  container.innerHTML = "";

  if (item.priceThick != null) {
    container.appendChild(
      buildOptionGroup({
        title: "厚度選擇 Thickness",
        name: "opt-thickness",
        type: "single",
        options: [
          { label: `吐司 (NT$${item.priceThin})`, value: "thin" },
          { label: `厚片 (NT$${item.priceThick})`, value: "thick" },
        ],
        isSelected: (v) => currentSelection.thickness === v,
        onSelect: (v) => (currentSelection.thickness = v),
      })
    );
  }

  (item.modifierGroups || []).forEach((groupId) => {
    const group = modifierGroups[groupId];
    container.appendChild(
      buildOptionGroup({
        title: group.label,
        name: `opt-group-${groupId}`,
        type: group.type,
        options: group.options.map((o, i) => ({
          label: o.price ? `${o.label} (+NT$${o.price})` : o.label,
          value: i,
        })),
        isSelected: (i) => {
          const picked = currentSelection.groups[groupId];
          return group.type === "multi" ? picked.includes(i) : picked === i;
        },
        onSelect: (i) => {
          if (group.type === "multi") {
            const set = new Set(currentSelection.groups[groupId]);
            set.has(i) ? set.delete(i) : set.add(i);
            currentSelection.groups[groupId] = [...set];
          } else {
            currentSelection.groups[groupId] = i;
          }
        },
      })
    );
  });

  if (item.addons && item.addons.length) {
    container.appendChild(
      buildOptionGroup({
        title: "加點 Extras",
        name: "opt-addons",
        type: "multi",
        options: item.addons.map((a, i) => ({ label: `${a.label} (+NT$${a.price})`, value: i })),
        isSelected: (i) => currentSelection.addons.includes(i),
        onSelect: (i) => {
          const set = new Set(currentSelection.addons);
          set.has(i) ? set.delete(i) : set.add(i);
          currentSelection.addons = [...set];
        },
      })
    );
  }

  updateOptionsSubtotal();
}

function updateOptionsQtyDisplay() {
  document.getElementById("options-qty").textContent = currentOptionsQty;
  document.getElementById("options-qty-decrement").disabled = currentOptionsQty <= 1;
}

function updateOptionsSubtotal() {
  const unit = lineUnitPrice(activeOptionsItem, currentSelection);
  document.getElementById("options-subtotal").textContent = `NT$${unit * currentOptionsQty}`;
  updateOptionsQtyDisplay();
}

function openOptionsSheet(item) {
  activeOptionsItem = item;
  currentOptionsQty = 1;
  currentSelection = {
    thickness: item.priceThick != null ? "thin" : null,
    groups: {},
    addons: [],
  };
  (item.modifierGroups || []).forEach((groupId) => {
    const group = modifierGroups[groupId];
    currentSelection.groups[groupId] = group.type === "multi" ? [] : 0;
  });

  document.getElementById("options-title").textContent = item.name;
  renderOptionsContent();
  document.getElementById("options-backdrop").hidden = false;
  document.getElementById("options-sheet").hidden = false;
}

function closeOptionsSheet() {
  document.getElementById("options-backdrop").hidden = true;
  document.getElementById("options-sheet").hidden = true;
  activeOptionsItem = null;
  currentSelection = null;
}

function confirmAddOptions() {
  const item = activeOptionsItem;
  const selection = currentSelection;
  const id = lineId(item.id, selection);
  const current = (cart[id] && cart[id].qty) || 0;
  cart[id] = { itemId: item.id, qty: current + currentOptionsQty, selection };
  closeOptionsSheet();
  updateCartBar();
}

// ------------------------------------------------------------
// Checkout sheet
// ------------------------------------------------------------

function openSheet() {
  const sheetItems = document.getElementById("sheet-items");
  sheetItems.innerHTML = "";
  Object.entries(cart).forEach(([id, line]) => {
    const item = findItem(line.itemId);
    const unit = lineUnitPrice(item, line.selection);
    const desc = describeSelection(item, line.selection);

    const row = document.createElement("div");
    row.className = "sheet-item-row";
    row.innerHTML = `
      <span>
        ${item.name} × ${line.qty}
        ${desc ? `<br><span class="sheet-item-mods">${desc}</span>` : ""}
      </span>
      <span class="sheet-item-right">
        NT$${unit * line.qty}
        <button class="sheet-item-remove" aria-label="remove">✕</button>
      </span>
    `;
    row.querySelector(".sheet-item-remove").addEventListener("click", () => {
      delete cart[id];
      openSheet();
      updateCartBar();
    });
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
  Object.values(cart).forEach((line) => {
    const item = findItem(line.itemId);
    const unit = lineUnitPrice(item, line.selection);
    const desc = describeSelection(item, line.selection);
    const label = desc ? `${item.name}（${desc}）` : item.name;
    lines.push(`${label} x${line.qty} — NT$${unit * line.qty}`);
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

  const orderItems = Object.values(cart).map((line) => {
    const item = findItem(line.itemId);
    const unit = lineUnitPrice(item, line.selection);
    return {
      id: line.itemId,
      name: item.name,
      modifiers: describeSelection(item, line.selection), // "" when the item has no customization
      qty: line.qty,
      subtotal: unit * line.qty,
    };
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

  document.getElementById("options-backdrop").addEventListener("click", closeOptionsSheet);
  document.getElementById("options-cancel").addEventListener("click", closeOptionsSheet);
  document.getElementById("options-add").addEventListener("click", confirmAddOptions);
  document.getElementById("options-qty-decrement").addEventListener("click", () => {
    currentOptionsQty = Math.max(1, currentOptionsQty - 1);
    updateOptionsSubtotal();
  });
  document.getElementById("options-qty-increment").addEventListener("click", () => {
    currentOptionsQty += 1;
    updateOptionsSubtotal();
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
