// ============================================================
// APP LOGIC
// Replace LIFF_ID below with the ID you get from the LINE
// Developers Console (see README.md for the steps).
// ============================================================

const LIFF_ID = "2011450491-x1jvqSz3";

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

// Outside LINE, loginWithLine()'s liff.login() is a real page redirect
// (LINE's OAuth page, then back) — a full reload, which would
// otherwise silently wipe the in-memory `cart` above and the note
// field along with it. persistCartForLoginRedirect() (called only from
// that outside-LINE branch — see loginWithLine()) saves both here;
// restoreCartAfterLoginRedirect() (called once from init(), before the
// first render) restores and immediately clears the entry, so it can
// never leak into an unrelated later session on the same device.
// Doesn't run/matter for the inside-LINE synchronous-login path at
// all, since that path never redirects and so never calls the persist
// half of this in the first place.
const LOGIN_REDIRECT_CART_KEY = "loginRedirectCart";

function persistCartForLoginRedirect() {
  try {
    sessionStorage.setItem(
      LOGIN_REDIRECT_CART_KEY,
      JSON.stringify({ cart, note: document.getElementById("order-note").value })
    );
  } catch (err) {
    console.error("[Login] failed to persist cart before redirect", err);
  }
}

function restoreCartAfterLoginRedirect() {
  let raw;
  try {
    raw = sessionStorage.getItem(LOGIN_REDIRECT_CART_KEY);
  } catch (err) {
    console.error("[Login] failed to read persisted cart", err);
    return;
  }
  if (!raw) return;

  // Clear first, before attempting to parse/apply — a malformed entry
  // shouldn't be able to leave itself stuck here forever.
  try {
    sessionStorage.removeItem(LOGIN_REDIRECT_CART_KEY);
  } catch (err) {
    console.error("[Login] failed to clear persisted cart", err);
  }

  try {
    const saved = JSON.parse(raw);
    Object.assign(cart, saved.cart);
    if (saved.note) document.getElementById("order-note").value = saved.note;
  } catch (err) {
    console.error("[Login] failed to restore persisted cart", err);
  }
}

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

// Items transcribed from the board carry certain tags as literal
// suffixes on the name — "(素)" for vegetarian, "(熱門)"/"(熱門?)" for
// popular — rather than dedicated data fields. This and an earlier
// pass aren't allowed to touch menu data, so both are derived from
// that existing text instead of adding real fields.
function parseItemTags(name) {
  const isVeg = /\(素\)/.test(name);
  const isPopular = /\(熱門\??\)/.test(name);
  const displayName = name.replace(/\s*\((素|熱門\??)\)\s*/g, " ").trim();
  return { displayName, isVeg, isPopular };
}

// Wires the +/− (or customize) handlers for one item's stepper —
// shared by every place an item can be rendered (browse list, search
// results, popular row), since the same item can appear in more than
// one of those at once.
function wireStepper(stepper, item, hasOptions) {
  if (hasOptions) {
    stepper.classList.remove("zero"); // no qty/decrement to hide — always just the + button
    stepper.querySelector(".add-btn").addEventListener("click", () => openOptionsSheet(item));
  } else {
    stepper.querySelector(".add-btn").addEventListener("click", () => changeQty(item.id, 1));
    stepper.querySelector(".decrement").addEventListener("click", () => changeQty(item.id, -1));
  }
}

// Stepper markup for one item, seeded from its current cart quantity
// (only meaningful for plain items — customized items always render
// at 0/hidden since they never show an inline qty, see renderMenu
// docs above). Needed because #menu-list gets rebuilt from scratch
// on every search/browse toggle, not just on cart changes, so a
// hardcoded "0" would silently drop out of sync with the real cart.
function stepperHtml(item, hasOptions) {
  const currentQty = hasOptions ? 0 : (cart[item.id] && cart[item.id].qty) || 0;
  return `
    <div class="stepper${currentQty === 0 ? " zero" : ""}" data-item-id="${item.id}">
      ${hasOptions ? "" : `<button class="decrement" aria-label="minus">−</button><span class="qty">${currentQty}</span>`}
      <button class="add-btn" aria-label="${hasOptions ? "customize" : "plus"}">＋</button>
    </div>
  `;
}

// Favourite-star markup for one item — member-only, [hidden] whenever
// currentMember.userId is falsy (mirrors how syncMemberState() decides
// logged-in-or-not elsewhere), filled/outline reflecting currentFavorites
// at render time. Shared by buildItemRow/buildPopularCard the same way
// stepperHtml() is, and wired the same way too (wireFavStar() below,
// called alongside wireStepper()).
function favStarHtml(item) {
  const isFav = currentFavorites.has(item.id);
  return `<button class="fav-star${isFav ? " active" : ""}" data-item-id="${item.id}" aria-label="我的最愛"${currentMember.userId ? "" : " hidden"}>${isFav ? "★" : "☆"}</button>`;
}

function wireFavStar(container, item) {
  const star = container.querySelector(".fav-star");
  star.addEventListener("click", (e) => {
    e.stopPropagation(); // don't let a tap on the star also trigger whatever the card itself might do
    toggleFavorite(item.id);
  });
}

// Builds one full-width item row — used for both the accordion's
// category content and the flat search-results list.
function buildItemRow(item) {
  const hasOptions = itemHasOptions(item);
  const priceLabel = item.priceThin != null
    ? `NT$${item.priceThin}${item.priceThick != null ? "起" : ""}`
    : `NT$${item.price}`;
  const { displayName, isVeg } = parseItemTags(item.name);

  const row = document.createElement("div");
  row.className = "menu-item";
  row.innerHTML = `
    <div class="item-info">
      <div class="item-name">${displayName}${isVeg ? `<span class="item-badge veg-badge">蛋奶素</span>` : ""}</div>
      <div class="item-name-en">${item.nameEn}</div>
      <div class="item-price">${priceLabel}</div>
      ${hasOptions ? `<div class="item-customize-hint">可客製化</div>` : ""}
    </div>
    ${favStarHtml(item)}
    ${stepperHtml(item, hasOptions)}
  `;
  wireStepper(row.querySelector(".stepper"), item, hasOptions);
  wireFavStar(row, item);
  return row;
}

// Builds one compact card for the horizontally-scrolling 熱門商品 row —
// same text/button components as buildItemRow, different container.
// Also reused as-is for #member-picks-row (我的最愛/常買推薦) — see
// renderMemberPicksRow() below.
function buildPopularCard(item) {
  const hasOptions = itemHasOptions(item);
  const priceLabel = item.priceThin != null
    ? `NT$${item.priceThin}${item.priceThick != null ? "起" : ""}`
    : `NT$${item.price}`;
  const { displayName, isVeg } = parseItemTags(item.name);

  const card = document.createElement("div");
  card.className = "popular-card";
  card.innerHTML = `
    <div class="popular-card-header">
      <div class="item-name">${displayName}${isVeg ? `<span class="item-badge veg-badge">蛋奶素</span>` : ""}</div>
      ${favStarHtml(item)}
    </div>
    <div class="item-price">${priceLabel}</div>
    ${stepperHtml(item, hasOptions)}
  `;
  wireStepper(card.querySelector(".stepper"), item, hasOptions);
  wireFavStar(card, item);
  return card;
}

// True once renderPopularRow() has run and found at least one item —
// used to keep the row hidden in browse mode too when there's nothing
// tagged (熱門)/(熱門?) in the current menu data.
let hasPopularItems = false;

function renderPopularRow() {
  const wrap = document.getElementById("popular-row-wrap");
  const row = document.getElementById("popular-row");
  row.innerHTML = "";

  const popularItems = [];
  MENU.forEach((category) => {
    category.items.forEach((item) => {
      if (parseItemTags(item.name).isPopular) popularItems.push(item);
    });
  });

  hasPopularItems = popularItems.length > 0;
  wrap.hidden = !hasPopularItems;
  popularItems.forEach((item) => row.appendChild(buildPopularCard(item)));
}

// Which category index is currently expanded (null = all collapsed).
let openCategoryIndex = null;

// Vertical accordion — one header row per category (name + item
// count + chevron), single-open-at-a-time, all collapsed by default.
function renderBrowseList() {
  const list = document.getElementById("menu-list");
  list.innerHTML = "";
  openCategoryIndex = null;

  MENU.forEach((category, catIndex) => {
    const section = document.createElement("div");
    section.className = "category-section";

    const header = document.createElement("button");
    header.className = "category-header";
    header.type = "button";
    header.innerHTML = `
      <span>${category.category} (${category.items.length})</span>
      <svg class="category-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;

    const content = document.createElement("div");
    content.className = "category-content";
    content.hidden = true;
    category.items.forEach((item) => content.appendChild(buildItemRow(item)));

    header.addEventListener("click", () => {
      const wasOpen = openCategoryIndex === catIndex;
      document.querySelectorAll(".category-header.open").forEach((h) => h.classList.remove("open"));
      document.querySelectorAll(".category-content").forEach((c) => (c.hidden = true));
      if (wasOpen) {
        openCategoryIndex = null;
      } else {
        header.classList.add("open");
        content.hidden = false;
        openCategoryIndex = catIndex;
      }
    });

    section.appendChild(header);
    section.appendChild(content);
    list.appendChild(section);
  });
}

// Flat, ungrouped list of every item whose name matches the query
// (case-insensitive substring, ignoring the (素)/(熱門) suffixes).
function renderSearchResults(query) {
  const list = document.getElementById("menu-list");
  list.innerHTML = "";
  const q = query.trim().toLowerCase();

  const matches = [];
  MENU.forEach((category) => {
    category.items.forEach((item) => {
      const { displayName } = parseItemTags(item.name);
      if (displayName.toLowerCase().includes(q)) matches.push(item);
    });
  });

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "找不到符合的餐點";
    list.appendChild(empty);
    return;
  }

  matches.forEach((item) => list.appendChild(buildItemRow(item)));
}

function wireSearchInput() {
  const input = document.getElementById("search-input");
  const popularWrap = document.getElementById("popular-row-wrap");

  input.addEventListener("input", () => {
    const query = input.value;
    if (query.trim() === "") {
      popularWrap.hidden = !hasPopularItems;
      renderBrowseList();
    } else {
      popularWrap.hidden = true;
      renderSearchResults(query);
    }
  });
}

function renderMenu() {
  document.getElementById("shop-name").textContent = SHOP_INFO.name;
  document.getElementById("shop-note").textContent = SHOP_INFO.pickupNote;

  document.getElementById("search-input").value = "";
  renderPopularRow();
  renderBrowseList();
}

// Plain (no-options) items only — items with options are added via
// the options sheet's "Add to cart" instead (see confirmAddOptions).
// Updates every rendered instance of this item (it may appear in the
// popular row, the open accordion section, and/or search results at
// the same time), keyed by data-item-id rather than a single id.
function changeQty(id, delta) {
  const current = (cart[id] && cart[id].qty) || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) delete cart[id];
  else cart[id] = { itemId: id, qty: next, selection: null };

  document.querySelectorAll(`.stepper[data-item-id="${id}"]`).forEach((stepper) => {
    stepper.querySelector(".qty").textContent = next;
    stepper.classList.toggle("zero", next === 0);
  });

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
        title: "厚度選擇",
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
        title: "加點",
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

// Shared caller for every Stored Value Edge Function invoked from this
// page (balance check on opening the sheet, spend on submit). Mirrors
// staff.js's identically-named helper — the two files are separate,
// no-build-step scripts with no shared module to put this in, so it's
// intentionally duplicated rather than reaching for a build step (see
// CLAUDE.md's Architecture section). Uniformly returns
// { ok, code?, error?, ... } whether the function itself responded
// (any status — its JSON body is always this shape, see
// supabase/functions/*/index.ts) or the request never completed at
// all (offline, CORS, malformed body) — callers branch on `.code` the
// same way regardless of which case it was.
async function callStoredValueFunction(name, payload) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
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

// Called fresh every time the checkout sheet opens (openSheet(), right
// below) — cart total can differ between opens (items added/removed),
// and balance can change between visits, so this never trusts a
// previous render. Always resets to 現場付款 checked first, so a
// stored-value choice from a previous open can never silently carry
// over into a differently-priced cart. Guests skip the network call
// entirely (currentMember.userId is the fast-path guard) rather than
// paying the round-trip for a check that can never apply to them.
async function renderPaymentMethodSection() {
  const section = document.getElementById("payment-method-section");
  document.getElementById("payment-method-cash").checked = true;
  section.hidden = true;

  if (!currentMember.userId) return;

  const total = cartTotal();
  if (total <= 0) return;

  let idToken;
  try {
    idToken = liff.isLoggedIn() ? liff.getIDToken() : null;
  } catch (err) {
    idToken = null;
  }
  if (!idToken) return;

  const result = await callStoredValueFunction("get-stored-value-balance", { id_token: idToken });
  if (!result.ok || result.balance < total) return; // insufficient or unreachable — no option shown at all, not a disabled one

  document.getElementById("payment-method-stored-value-text").textContent =
    `使用儲值支付（餘額：NT$${result.balance}）`;
  section.hidden = false;
}

async function openSheet() {
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
  await renderPaymentMethodSection();
  document.getElementById("sheet-backdrop").hidden = false;
  document.getElementById("checkout-sheet").hidden = false;
}

function closeSheet() {
  document.getElementById("sheet-backdrop").hidden = true;
  document.getElementById("checkout-sheet").hidden = true;
}

function buildOrderMessage() {
  const lines = [`📋 新訂單`, ``];
  Object.values(cart).forEach((line) => {
    const item = findItem(line.itemId);
    const unit = lineUnitPrice(item, line.selection);
    const desc = describeSelection(item, line.selection);
    const label = desc ? `${item.name}（${desc}）` : item.name;
    lines.push(`${label} x${line.qty} — NT$${unit * line.qty}`);
  });
  lines.push(``, `總計：NT$${cartTotal()}`);

  const note = document.getElementById("order-note").value.trim();
  if (note) lines.push(``, `備註：${note}`);

  return lines.join("\n");
}

// Flex Message "receipt card" sent into the LINE chat alongside the
// Supabase save — same Signature Red palette as style.css, hardcoded
// here since Flex Message JSON is sent to LINE's API, not rendered by
// our own CSS, so it can't reference the custom properties directly.
// altText reuses buildOrderMessage()'s plain-text summary — it's what
// LINE shows in push notifications / chat-list previews when the
// bubble itself can't render, and it's required on every Flex Message.
function buildOrderFlexMessage(saved, orderItems, total, waitText) {
  const itemRows = orderItems.map((item) => ({
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "text",
        text: item.modifiers ? `${item.name}（${item.modifiers}）x${item.qty}` : `${item.name} x${item.qty}`,
        size: "sm",
        color: "#2b211c",
        flex: 4,
        wrap: true,
      },
      { type: "text", text: `$${item.subtotal}`, size: "sm", color: "#2b211c", flex: 1, align: "end" },
    ],
  }));

  return {
    type: "flex",
    altText: buildOrderMessage() + `\n訂單編號 #${saved.short_id}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#e0132b",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "樂福", weight: "bold", size: "xl", color: "#ffffff" },
          { type: "text", text: `訂單編號 #${saved.short_id}`, size: "sm", color: "#ffffff", margin: "sm" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#fbefe6",
        paddingAll: "16px",
        spacing: "sm",
        contents: [
          ...itemRows,
          { type: "separator", margin: "md", color: "#fbdfda" },
          {
            type: "box",
            layout: "horizontal",
            margin: "md",
            contents: [
              { type: "text", text: "總計", weight: "bold", size: "md", color: "#e0132b" },
              { type: "text", text: `NT$${total}`, weight: "bold", size: "md", color: "#e0132b", align: "end" },
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#fbefe6",
        paddingAll: "16px",
        contents: [{ type: "text", text: waitText, size: "xs", color: "#2b211c", wrap: true }],
      },
    },
  };
}

// Reveals the header's signed-in indicator (see .member-badge in
// style.css / index.html) — called once syncLoggedInProfile() below
// has a real profile. Tapping it opens #member-menu (see
// toggleMemberMenu() below) — today just 登出, but built as the anchor
// point future member features (order history, points, stored value)
// will attach to as more menu entries, not a finished member UI.
function showMemberBadge(profile) {
  const avatar = document.getElementById("member-avatar");
  if (profile.pictureUrl) {
    avatar.src = profile.pictureUrl;
    avatar.hidden = false;
  } else {
    avatar.hidden = true; // not every LINE profile has a picture set
  }
  document.getElementById("member-name").textContent = profile.displayName || "";
  document.getElementById("member-badge").hidden = false;
  document.getElementById("member-pill").hidden = true;
}

// The header's other face for the same slot .member-badge occupies —
// shown instead of the badge for anyone not currently logged in.
// Tapping it opens the benefits card (see wireUpUI()). Same [hidden]-
// override idiom as .member-badge/.cart-bar/.confirm-screen in
// style.css — never give this an unconditional `display` without one.
function showMemberPill() {
  document.getElementById("member-pill").hidden = false;
  document.getElementById("member-badge").hidden = true;
}

// ------------------------------------------------------------
// Member menu — small popover anchored to #member-badge (see
// .member-menu in style.css). Deliberately a bare list shell: today's
// only entry is 登出, but future entries (order history, stored value
// balance, stamp card progress, favourites) are meant to be appended
// as more .member-menu-item buttons in index.html + more click
// handlers here, not a redesign of this shell.
// ------------------------------------------------------------

function openMemberMenu() {
  document.getElementById("member-menu-backdrop").hidden = false;
  document.getElementById("member-menu").hidden = false;
  document.getElementById("member-badge").setAttribute("aria-expanded", "true");
}

function closeMemberMenu() {
  document.getElementById("member-menu-backdrop").hidden = true;
  document.getElementById("member-menu").hidden = true;
  document.getElementById("member-badge").setAttribute("aria-expanded", "false");
}

function toggleMemberMenu() {
  if (document.getElementById("member-menu").hidden) openMemberMenu();
  else closeMemberMenu();
}

// The only place liff.logout() is called. liff.logout() is a local SDK
// call (clears LIFF's own stored session, no network round trip, no
// redirect), so unlike loginWithLine() there's no async/navigate-away
// case to handle here — this resets local state and the header view
// synchronously, without a page reload, so an in-progress cart is
// untouched (same reasoning as persistCartForLoginRedirect() above,
// just with nothing to persist since nothing ever unloads). Does NOT
// reset guestCheckoutChosen — logging out mid-session doesn't retroactively
// mean checkout should start asking again this session.
function handleLogout() {
  closeMemberMenu();
  try {
    liff.logout();
  } catch (err) {
    console.error("[Login] liff.logout() failed", err);
  }
  currentMember = { userId: null, isTest: false, profile: null };
  currentFavorites = new Set();
  frequentlyBoughtItemIds = null;
  showMemberPill();
  refreshFavoriteUI();
  renderMemberPicksRow();
}

// Current session's LINE identity. isTest is decided by isTesterMode()
// (supabase-config.js) — it no longer means "gated behind a tester
// flag to log in at all" (login is available to everyone, by choice);
// it only flags this specific logged-in user's orders as test orders
// so they land in staff.html's Test Orders section instead of the
// live kitchen queue.
let currentMember = { userId: null, isTest: false, profile: null };

// Favourites/order-history state for the current member — both reset
// to their logged-out defaults on logout (see handleLogout() below)
// and populated fresh on login (see loadMemberPicks()). currentFavorites
// holds item ids; frequentlyBoughtItemIds is null until computed (only
// happens when currentFavorites is empty — see loadMemberPicks()) so
// "not computed yet" and "computed, genuinely nothing" stay distinguishable.
let currentFavorites = new Set();
let frequentlyBoughtItemIds = null;

// Once true, submitOrder() stops asking an anonymous visitor to choose
// between LINE login and guest checkout for the rest of this page
// session — in-memory only, deliberately not persisted beyond it.
let guestCheckoutChosen = false;

// Shared by syncMemberState() (silent page-load check) and
// loginWithLine() (after an explicit tap logs someone in) — keeps
// "what happens once we have a real profile" in one place so the two
// call sites can't drift apart.
async function syncLoggedInProfile(profile) {
  console.log(`[Login] ${profile.displayName} (${profile.userId})`);
  const isTest = await isTesterMode(profile.userId);
  currentMember = { userId: profile.userId, isTest, profile };
  await upsertMember(profile);
  showMemberBadge(profile);
  await loadMemberPicks();
}

// ------------------------------------------------------------
// Favourites / 常買推薦 — member-only. currentFavorites drives the
// ☆/★ star on every item card (favStarHtml()/wireFavStar() above);
// #member-picks-row shows favourited items whenever there are any, or
// a frequently-bought fallback when there aren't (see
// renderMemberPicksRow()), same buildPopularCard() component as 熱門.
// ------------------------------------------------------------

// Called once right after login resolves (syncLoggedInProfile()) — not
// on every render, since favourites/order history only change via
// explicit actions (a star tap, placing an order) elsewhere in the
// same session, not spontaneously. Always resets frequentlyBoughtItemIds
// to null (re-fetched lazily by renderMemberPicksRow() only if/when it
// turns out to be needed) rather than deciding here whether it's
// needed — toggleFavorite() re-renders this same row without going
// through this function again, so that decision has to live in one
// place both call sites share, not be duplicated between them.
async function loadMemberPicks() {
  currentFavorites = new Set(await getFavoriteItemIds(currentMember.userId));
  frequentlyBoughtItemIds = null;
  refreshFavoriteUI();
  await renderMemberPicksRow();
}

// Updates every already-rendered ☆/★ star to match currentFavorites/
// currentMember — needed because renderMenu()/renderPopularRow() may
// have already built cards (as a guest, or before login resolved)
// before loadMemberPicks() had anything to show; called again here
// rather than re-rendering the whole menu, which would blow away
// search text / open accordion state for no reason.
function refreshFavoriteUI() {
  document.querySelectorAll(".fav-star").forEach((star) => {
    const isFav = currentFavorites.has(star.dataset.itemId);
    star.hidden = !currentMember.userId;
    star.classList.toggle("active", isFav);
    star.textContent = isFav ? "★" : "☆";
  });
}

// Optimistic flip first, DB write second — reverted (with a re-render)
// if the write fails, so the UI never ends up claiming a state that
// didn't actually save.
async function toggleFavorite(itemId) {
  if (!currentMember.userId) return; // defensive — the star is [hidden] for guests in the first place
  const userId = currentMember.userId;
  const wasFavorited = currentFavorites.has(itemId);

  if (wasFavorited) currentFavorites.delete(itemId);
  else currentFavorites.add(itemId);
  refreshFavoriteUI();
  await renderMemberPicksRow(); // reflect the change in 我的最愛/常買推薦 immediately too

  try {
    if (wasFavorited) await removeFavorite(userId, itemId);
    else await addFavorite(userId, itemId);
  } catch (err) {
    console.error("[Favorites] toggle failed, reverting", err);
    if (wasFavorited) currentFavorites.add(itemId);
    else currentFavorites.delete(itemId);
    refreshFavoriteUI();
    await renderMemberPicksRow();
  }
}

// Exactly one of 我的最愛 (any favourites exist) / 常買推薦 (zero
// favourites, some order history) / hidden (neither) at a time.
// currentFavorites is always trusted as already current (loadMemberPicks()/
// toggleFavorite() both keep it so); frequentlyBoughtItemIds is instead
// fetched lazily right here, the first time it's actually needed —
// unfavouriting someone's last item re-enters this same "zero
// favourites" branch without going through loadMemberPicks() again, so
// the fetch has to live here, not there, or that path would wrongly
// find frequentlyBoughtItemIds still null and hide the row instead of
// falling back to it. Once fetched, it's cached until the next login
// (see loadMemberPicks() resetting it to null) — re-favouriting
// something and unfavouriting it again this same session reuses the
// cached value rather than re-fetching.
async function renderMemberPicksRow() {
  const wrap = document.getElementById("member-picks-wrap");
  const titleEl = document.getElementById("member-picks-title");
  const row = document.getElementById("member-picks-row");

  if (!currentMember.userId) {
    wrap.hidden = true;
    row.innerHTML = "";
    return;
  }

  if (currentFavorites.size === 0 && frequentlyBoughtItemIds === null) {
    frequentlyBoughtItemIds = await getFrequentlyBoughtItemIds(currentMember.userId);
  }

  const itemIds = currentFavorites.size > 0 ? [...currentFavorites] : frequentlyBoughtItemIds;
  const items = itemIds.map(findItem).filter(Boolean); // filter(Boolean): a favourited/ordered id no longer in MENU shouldn't render a broken card

  if (items.length === 0) {
    wrap.hidden = true;
    row.innerHTML = "";
    return;
  }

  titleEl.textContent = currentFavorites.size > 0 ? "我的最愛" : "常買推薦";
  row.innerHTML = "";
  items.forEach((item) => row.appendChild(buildPopularCard(item)));
  wrap.hidden = false;
}

// Silent membership check — called once from init() at page load.
// liff.isLoggedIn() alone never shows anything (it's a state read, not
// an action), so this is safe to always run: logged in already (e.g.
// LIFF's silent in-client auto-login, or a returning liff.login()
// redirect) shows the badge; anyone else sees the "Become a Member"
// pill instead. Never calls liff.login() itself — see loginWithLine()
// for the only place that does.
async function syncMemberState() {
  try {
    if (!liff.isLoggedIn()) {
      showMemberPill();
      return;
    }
    const profile = await liff.getProfile();
    await syncLoggedInProfile(profile);
  } catch (err) {
    console.error("[Login] syncMemberState failed — showing guest pill", err);
    showMemberPill();
  }
}

// The ONLY place liff.login() is called — exclusively from an explicit
// tap (the benefits card's button, or the checkout dialog's LINE
// button), never automatically. Returns true once currentMember is
// actually populated, meaning the caller can safely proceed attributing
// something to this identity; false otherwise. False covers two very
// different cases the caller must not treat the same as a green light:
// liff.login() navigating away entirely (outside LINE — this page is
// unloading, nothing after this in the current load matters) or a
// genuine failure — either way, the caller should NOT silently fall
// back to guest behavior on the visitor's behalf.
async function loginWithLine() {
  try {
    if (!liff.isLoggedIn()) {
      persistCartForLoginRedirect(); // outside-LINE only — see the comment by LOGIN_REDIRECT_CART_KEY
      liff.login();
      return false; // navigates away (outside LINE) or is mid-flight
    }
    // Already logged in — e.g. LIFF's silent in-client auto-login beat
    // us to it since the pill/dialog was shown. Sync and continue
    // synchronously instead of redirecting for no reason.
    const profile = await liff.getProfile();
    await syncLoggedInProfile(profile);
    return true;
  } catch (err) {
    console.error("[Login] loginWithLine failed", err);
    return false;
  }
}

// Single source for the three member-benefit rows shown identically
// in #benefits-card and the checkout auth dialog (#checkout-auth-dialog)
// — edit the copy here, not in index.html, so the two can't drift
// apart. renderBenefitRows() builds the same {placeholder, caption}
// markup used before this was factored out — same .benefit-row/
// .benefit-placeholder/.benefit-caption classes, same styling.
const MEMBER_BENEFIT_CAPTIONS = [
  "累積點數，兌換優惠與免費商品！",
  "儲值餘額，結帳更快速，取餐無縫接軌。",
  "優先顯示最愛餐點，下次點餐更省時！",
];

function renderBenefitRows(container) {
  container.innerHTML = "";
  MEMBER_BENEFIT_CAPTIONS.forEach((caption) => {
    const row = document.createElement("div");
    row.className = "benefit-row";

    const placeholder = document.createElement("div");
    placeholder.className = "benefit-placeholder";
    placeholder.setAttribute("aria-hidden", "true");

    const captionEl = document.createElement("p");
    captionEl.className = "benefit-caption";
    captionEl.textContent = caption;

    row.appendChild(placeholder);
    row.appendChild(captionEl);
    container.appendChild(row);
  });
}

function openBenefitsCard() {
  document.getElementById("benefits-backdrop").hidden = false;
  document.getElementById("benefits-card").hidden = false;
}

function closeBenefitsCard() {
  document.getElementById("benefits-backdrop").hidden = true;
  document.getElementById("benefits-card").hidden = true;
}

// Resolves once the visitor makes a choice in the checkout auth dialog
// — 'guest', 'line', or null if dismissed without choosing (backdrop
// tap). Listeners are attached/detached fresh per call rather than
// once at load, since this can legitimately run more than once in a
// session (e.g. "Sign in with LINE" fails, they try again).
function askCheckoutAuthChoice() {
  return new Promise((resolve) => {
    const backdrop = document.getElementById("checkout-auth-backdrop");
    const dialog = document.getElementById("checkout-auth-dialog");
    const lineBtn = document.getElementById("checkout-auth-line");
    const guestBtn = document.getElementById("checkout-auth-guest");

    function done(choice) {
      backdrop.hidden = true;
      dialog.hidden = true;
      lineBtn.removeEventListener("click", onLine);
      guestBtn.removeEventListener("click", onGuest);
      backdrop.removeEventListener("click", onDismiss);
      resolve(choice);
    }
    const onLine = () => done("line");
    const onGuest = () => done("guest");
    const onDismiss = () => done(null);

    lineBtn.addEventListener("click", onLine);
    guestBtn.addEventListener("click", onGuest);
    backdrop.addEventListener("click", onDismiss);

    backdrop.hidden = false;
    dialog.hidden = false;
  });
}

async function submitOrder() {
  // Ask only for a currently-anonymous visitor who hasn't already
  // chosen guest checkout this session — everyone else (already
  // logged in, or already chose guest once) skips straight through,
  // exactly as checkout worked before this feature existed.
  if (!currentMember.userId && !guestCheckoutChosen) {
    const choice = await askCheckoutAuthChoice();
    if (choice === "guest") {
      guestCheckoutChosen = true;
    } else if (choice === "line") {
      const ok = await loginWithLine();
      if (!ok) {
        // Don't silently place a guest order they didn't ask for —
        // liff.login() either navigated away entirely (nothing left
        // to do here) or failed outright. They can tap "Send order"
        // again once they're back/ready.
        return;
      }
      // ok === true: currentMember is now populated (a synchronous,
      // already-logged-in-in-client case) — fall through and place
      // the order attributed to them, below.
    } else {
      return; // dismissed without choosing — do nothing
    }
  }

  const { userId, isTest } = currentMember;

  const submitBtn = document.getElementById("submit-order");
  submitBtn.disabled = true;
  submitBtn.textContent = "送出中…";

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

  // Only ever "stored_value" if the section is actually visible — a
  // guest or insufficient-balance visitor can never end up on it no
  // matter what a stale radio state might say, since they were never
  // shown the choice in the first place (see renderPaymentMethodSection()).
  const paymentSection = document.getElementById("payment-method-section");
  const paymentMethod =
    !paymentSection.hidden && document.getElementById("payment-method-stored-value").checked
      ? "stored_value"
      : "cash_on_pickup";

  try {
    // Stored-value orders generate their id client-side and spend
    // against it *before* the order itself exists — spend-stored-value
    // and this order row end up sharing the same id, so the deduction
    // and the order it paid for are always linkable. Cash orders keep
    // letting Postgres generate the id, exactly as before this feature
    // existed (orderId stays null, insertOrder() below leaves it unset).
    let orderId = null;

    if (paymentMethod === "stored_value") {
      orderId = crypto.randomUUID();

      let idToken;
      try {
        idToken = liff.getIDToken();
      } catch (err) {
        idToken = null;
      }

      const spendResult = idToken
        ? await callStoredValueFunction("spend-stored-value", {
            id_token: idToken,
            amount: total,
            order_id: orderId,
          })
        : { ok: false, code: "unknown", error: "No ID token available" };

      if (!spendResult.ok) {
        // Most likely insufficient_funds from a race with another
        // order placed elsewhere since the balance was already checked
        // once when the sheet opened — not a hard failure. Let them
        // retry with cash instead of blocking checkout outright; no
        // order has been touched yet at this point, so there's nothing
        // to roll back.
        console.error("[Checkout] spend-stored-value failed", spendResult);
        alert("儲值餘額不足，請改用現場付款");
        document.getElementById("payment-method-cash").checked = true;
        paymentSection.hidden = true; // don't re-offer a balance we now know doesn't cover it, for the rest of this attempt
        return;
      }
    }

    let saved;
    try {
      // Save the order to Supabase — this is the source of truth for
      // status tracking and printing at the shop.
      saved = await insertOrder({
        items: orderItems,
        total,
        note,
        userId,
        isTest,
        id: orderId,
        paymentMethod,
      });
    } catch (err) {
      console.error(err);
      if (paymentMethod === "stored_value") {
        // The spend above already succeeded — this is a genuinely bad
        // state (money moved, no order recorded), not the ordinary
        // "nothing happened yet, just retry" case. No automatic
        // reconciliation exists yet, so this is surfaced distinctly
        // rather than silently treated like any other retry-safe
        // failure — a blind "retry" here would place a second, unpaid
        // order while leaving the first deduction orphaned.
        alert(`訂單儲存失敗，但儲值已扣款，請聯繫店員處理。訂單編號：${orderId}`);
      } else {
        alert("送出失敗，請重試");
      }
      return;
    }

    // From here on the order already exists — nothing below should be
    // able to flip the UI back to "failed" and prompt a duplicate
    // submission. Each optional step logs and continues on its own.

    let waitMinutes = null;
    try {
      // Estimate pickup time from current queue length
      const queueAhead = await getQueueCount();
      waitMinutes = estimateWaitMinutes(itemCount, queueAhead - 1); // exclude the order just placed
    } catch (err) {
      console.error("Queue estimate failed (order already saved, continuing):", err);
    }
    const waitText =
      waitMinutes != null
        ? `預估取餐時間：約 ${waitMinutes} 分鐘`
        : `預估取餐時間：請洽店員`;

    try {
      // Also drop a copy into the LINE chat so it's visible there too
      // (optional — remove this block if you'd rather rely on the
      // staff tablet only).
      if (liff.isInClient()) {
        await liff.sendMessages([buildOrderFlexMessage(saved, orderItems, total, waitText)]);
      }
    } catch (err) {
      console.error("LIFF sendMessages failed (order already saved, continuing):", err);
    }

    document.getElementById("confirm-wait").textContent = waitText;
    document.getElementById("confirm-order-id").textContent = `訂單編號 #${saved.short_id}`;

    closeSheet();
    Object.keys(cart).forEach((id) => delete cart[id]);
    document.getElementById("order-note").value = "";
    renderMenu();
    updateCartBar();
    document.getElementById("confirm-screen").hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "送出訂單";
  }
}

function wireUpUI() {
  wireSearchInput();

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

  document.getElementById("member-pill").addEventListener("click", openBenefitsCard);
  document.getElementById("benefits-close").addEventListener("click", closeBenefitsCard); // X: zero side effects, reopenable via the pill anytime
  document.getElementById("benefits-backdrop").addEventListener("click", closeBenefitsCard);
  document.getElementById("benefits-login").addEventListener("click", async () => {
    await loginWithLine();
    closeBenefitsCard(); // closes either way — on success the badge already replaced the pill underneath
  });

  document.getElementById("member-badge").addEventListener("click", toggleMemberMenu);
  document.getElementById("member-menu-backdrop").addEventListener("click", closeMemberMenu);
  document.getElementById("member-menu-logout").addEventListener("click", handleLogout);
}

async function init() {
  restoreCartAfterLoginRedirect(); // before the first render, so restored quantities show immediately, not after a flash of empty
  wireUpUI();
  renderMenu();
  updateCartBar(); // renderMenu() doesn't touch the cart bar itself — reflect a restored cart's count/total right away
  renderBenefitRows(document.getElementById("benefits-rows"));
  renderBenefitRows(document.getElementById("checkout-benefits-rows"));

  try {
    await liff.init({ liffId: LIFF_ID });
  } catch (err) {
    console.error("LIFF init failed", err);
    // Menu still works for browser testing even if LIFF can't init
  }

  await syncMemberState(); // silent check only — see loginWithLine() for the only place login is actually triggered
}

init();
