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
// selection is null for an item with no options, otherwise
// { thickness: "thin"|"thick"|null,
//   groups: { [groupId]: optionId | [optionIds] },
//   addons: [addonIds] }
// — option/add-on IDS from menu.json, never array indexes, so reordering
// options in menu.json can't silently change what a cart line means.
const cart = {};

// ------------------------------------------------------------
// Menu data — fetched from /menu.json (the single source of truth for
// items, prices, options and pricing/pickup rules; see its own _notes)
// by loadMenu() in init(), before anything renders. Nothing below may
// touch these until loadMenu() has resolved.
// ------------------------------------------------------------
let MENU = [];
let modifierGroups = {};
let SHOP_INFO = null;
let MENU_RULES = null;
let MENU_VERSION = null;

async function loadMenu() {
  const res = await fetch("/menu.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`menu.json HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.menu) || !data.modifierGroups || !data.shopInfo || !data.rules) {
    throw new Error("menu.json is missing required fields");
  }
  MENU = data.menu;
  modifierGroups = data.modifierGroups;
  SHOP_INFO = data.shopInfo;
  MENU_RULES = data.rules;
  MENU_VERSION = data.version;
  applyPickupRules(data.rules.pickup);
}

function showMenuLoadError() {
  document.getElementById("shop-name").textContent = "";
  document.getElementById("search-input").closest(".search-bar").hidden = true;
  const empty = document.getElementById("empty-state");
  empty.querySelector("p").textContent = "菜單載入失敗";
  empty.querySelector(".empty-sub").textContent = "請檢查網路連線後重新整理頁面";
  empty.hidden = false;
}

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
// Bump whenever the stored cart's shape changes. A stored cart with any
// other (or no) version is discarded on restore, never migrated —
// version 2 is the switch from option/add-on array indexes to ids.
const CART_FORMAT_VERSION = 2;

function persistCartForLoginRedirect() {
  try {
    sessionStorage.setItem(
      LOGIN_REDIRECT_CART_KEY,
      JSON.stringify({ v: CART_FORMAT_VERSION, cart, note: document.getElementById("order-note").value })
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
    if (!saved || saved.v !== CART_FORMAT_VERSION) {
      console.warn("[Login] discarding persisted cart with old/missing format version", saved && saved.v);
      return;
    }
    // Keep only lines that still make sense against the menu.json just
    // loaded (it may have changed between leaving for LINE's login page
    // and coming back) — anything else would price as NaN or throw.
    Object.entries(saved.cart || {}).forEach(([id, line]) => {
      const item = line && findItem(line.itemId);
      if (item && Number.isInteger(line.qty) && line.qty > 0 && isValidSelection(item, line.selection)) {
        cart[id] = line;
      } else {
        console.warn("[Login] dropping persisted cart line no longer valid for this menu", id);
      }
    });
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

// Option/add-on lookups by id. Throw on an unknown id rather than
// silently pricing it as 0 — every selection built by the options sheet
// or restored from sessionStorage (isValidSelection()) only ever holds
// ids that exist in the loaded menu.json.
function groupOption(group, optionId) {
  const option = group.options.find((o) => o.id === optionId);
  if (!option) throw new Error(`unknown option id "${optionId}"`);
  return option;
}

// A single group's picked option — its first option (the default) when
// nothing was picked, same as the options sheet preselects.
function singlePick(group, picked) {
  return groupOption(group, picked != null ? picked : group.options[0].id);
}

// A multi group's picked options, duplicates dropped (first occurrence
// wins, so the order ticked is kept — describeSelection() lists them in
// that order, same as before ids replaced indexes).
function multiPicks(group, picked) {
  return [...new Set(picked || [])].map((id) => groupOption(group, id));
}

// The item's add-ons that are selected, in menu.json order (not tick
// order), each counted once however many times its id appears.
function selectedAddons(item, selection) {
  const ids = new Set(selection.addons || []);
  return (item.addons || []).filter((addon) => ids.has(addon.id));
}

function lineUnitPrice(item, selection) {
  let total = lineBasePrice(item, selection);
  if (!selection) return total;

  (item.modifierGroups || []).forEach((groupId) => {
    const group = modifierGroups[groupId];
    const picked = selection.groups[groupId];
    if (group.type === "multi") {
      multiPicks(group, picked).forEach((option) => (total += option.price));
    } else {
      total += singlePick(group, picked).price;
    }
  });

  selectedAddons(item, selection).forEach((addon) => (total += addon.price));

  return total;
}

// Whether a selection (e.g. one restored from sessionStorage) only
// refers to thickness/options/add-ons this item actually offers in the
// current menu.json.
function isValidSelection(item, selection) {
  if (selection == null) return !itemHasOptions(item);
  if (typeof selection !== "object") return false;

  const hasThickness = item.priceThick != null;
  if (hasThickness ? !["thin", "thick"].includes(selection.thickness) : selection.thickness != null) return false;

  const itemGroups = item.modifierGroups || [];
  const groups = selection.groups || {};
  if (Object.keys(groups).some((groupId) => !itemGroups.includes(groupId))) return false;
  const groupsOk = itemGroups.every((groupId) => {
    const group = modifierGroups[groupId];
    const picked = groups[groupId];
    const known = (id) => group.options.some((o) => o.id === id);
    if (group.type === "multi") return picked == null || (Array.isArray(picked) && picked.every(known));
    return picked == null || known(picked);
  });
  if (!groupsOk) return false;

  const addonIds = (item.addons || []).map((a) => a.id);
  return Array.isArray(selection.addons || []) && (selection.addons || []).every((id) => addonIds.includes(id));
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
      multiPicks(group, picked).forEach((option) => parts.push(`+${option.label}`));
    } else {
      const option = singlePick(group, picked);
      // Only call out the choice when it's not the plain first option —
      // e.g. "抓餅" is worth showing, "原味" isn't.
      if (option !== group.options[0]) parts.push(option.label);
    }
  });

  selectedAddons(item, selection).forEach((addon) => parts.push(`+${addon.label}`));

  return parts.join("、");
}

// Deterministic id for a (item, selection) pair so re-adding the same
// exact customization merges into the same cart line instead of
// creating a duplicate. Multi-group and add-on ids are de-duplicated
// and sorted, so tick order doesn't create separate lines.
function lineId(itemId, selection) {
  if (!selection) return itemId;
  const groups = {};
  Object.keys(selection.groups || {})
    .sort()
    .forEach((groupId) => {
      const v = selection.groups[groupId];
      groups[groupId] = Array.isArray(v) ? [...new Set(v)].sort() : v;
    });
  const addons = [...new Set(selection.addons || [])].sort();
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
  return `<button class="fav-star${isFav ? " active" : ""}" data-item-id="${item.id}" aria-label="我的最愛"${favoritesUsable() ? "" : " hidden"}>${isFav ? "★" : "☆"}</button>`;
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
        options: group.options.map((o) => ({
          label: o.price ? `${o.label} (+NT$${o.price})` : o.label,
          value: o.id,
        })),
        isSelected: (id) => {
          const picked = currentSelection.groups[groupId];
          return group.type === "multi" ? picked.includes(id) : picked === id;
        },
        onSelect: (id) => {
          if (group.type === "multi") {
            const set = new Set(currentSelection.groups[groupId]);
            set.has(id) ? set.delete(id) : set.add(id);
            currentSelection.groups[groupId] = [...set];
          } else {
            currentSelection.groups[groupId] = id;
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
        options: item.addons.map((a) => ({ label: `${a.label} (+NT$${a.price})`, value: a.id })),
        isSelected: (id) => currentSelection.addons.includes(id),
        onSelect: (id) => {
          const set = new Set(currentSelection.addons);
          set.has(id) ? set.delete(id) : set.add(id);
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
    currentSelection.groups[groupId] = group.type === "multi" ? [] : group.options[0].id;
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
// Pickup time slots — 15-minute slots across the shop's 6:00-9:00AM
// Asia/Taipei window. Reservation itself is atomic and authoritative
// server-side (place-order → place_order() → reserve_pickup_slot(),
// race-safe via a single UPDATE) — everything here is just deciding what to show and
// pre-checking availability for display, never the real guarantee.
//
// Same "shift by the fixed +8h offset, read UTC fields as Taipei-local
// fields" trick as the Weekday Stamp Card's date math
// (supabase/functions/_shared/taipeiWeek.ts) — duplicated here rather
// than shared, since there's no module boundary between this browser
// script and that Deno runtime.
// ------------------------------------------------------------

// Set from menu.json's rules.pickup by applyPickupRules() (called from
// loadMenu()) — 15 / 6 / 06:00 / 09:00 / 30 as of this writing.
let SLOT_LENGTH_MINUTES = null;
let MAX_ORDERS_PER_SLOT = null; // display only (已滿); place-order enforces the real cap server-side
let PICKUP_WINDOW_START_MINUTES = null; // minutes after Taipei midnight, e.g. 06:00 → 360
let PICKUP_WINDOW_END_MINUTES = null; // exclusive, so at 09:00 the last slot starts 8:45
let PICKUP_MIN_LEAD_MINUTES = null;
// Fixed +8h, not derived from rules.pickup.timezone — Asia/Taipei has
// no DST, and menu.json's _notes say that field must stay Asia/Taipei.
const PICKUP_TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
// MUST equal SLOT_LEAD_GRACE_MINUTES in
// supabase/functions/_shared/pickupSlot.ts. The picker OFFERS slots at
// least minLeadMinutes ahead; the server still ACCEPTS an already-chosen
// slot until it's less than (minLeadMinutes - this) ahead, so the
// auto-refresh below only moves the customer off their slot once the
// server would actually reject it.
const PICKUP_LEAD_GRACE_MINUTES = 5;
const PICKUP_REFRESH_MS = 60 * 1000;

function parseClockMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function applyPickupRules(pickup) {
  SLOT_LENGTH_MINUTES = pickup.slotMinutes;
  MAX_ORDERS_PER_SLOT = pickup.perSlot;
  PICKUP_WINDOW_START_MINUTES = parseClockMinutes(pickup.open);
  PICKUP_WINDOW_END_MINUTES = parseClockMinutes(pickup.close);
  PICKUP_MIN_LEAD_MINUTES = pickup.minLeadMinutes;
}
const PICKUP_TAIPEI_WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"]; // Date.getUTCDay() index, Taipei-shifted

// Current Taipei-local calendar date, as UTC-numbered fields (month is
// 0-11, matching Date.UTC()'s own convention, not the 1-12 used
// elsewhere in this file's isTaipeiFriday()-adjacent code).
function taipeiNowParts() {
  const shifted = new Date(Date.now() + PICKUP_TAIPEI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

// The real UTC Date instant for a given Taipei calendar day + local
// hour/minute.
function taipeiDateTime(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month, day, hour, minute) - PICKUP_TAIPEI_OFFSET_MS);
}

function addTaipeiDays({ year, month, day }, days) {
  const shifted = new Date(Date.UTC(year, month, day) + days * 24 * 60 * 60 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

// All slot start times (as real Date instants) for one Taipei calendar
// day — 12 of them at the current constants (6:00 to 8:45).
function buildSlotsForDay(taipeiDay) {
  const slots = [];
  for (let m = PICKUP_WINDOW_START_MINUTES; m < PICKUP_WINDOW_END_MINUTES; m += SLOT_LENGTH_MINUTES) {
    slots.push(taipeiDateTime(taipeiDay.year, taipeiDay.month, taipeiDay.day, Math.floor(m / 60), m % 60));
  }
  return slots;
}

// The slot list to actually offer right now: today's remaining slots
// (earliest selectable = now + rules.pickup.minLeadMinutes, rounded UP
// to the next slot boundary) if any remain before the window's last slot, otherwise
// tomorrow's full list — never an empty picker. Whether "today" even
// has any remaining slots (window not yet reached, mid-window, or
// already closed for the day) all fall out of the same >= filter below
// rather than needing separate cases for each.
function getAvailablePickupSlots() {
  const today = taipeiNowParts();
  const todaySlots = buildSlotsForDay(today);

  const earliestMs = Date.now() + PICKUP_MIN_LEAD_MINUTES * 60 * 1000;
  const shifted = new Date(earliestMs + PICKUP_TAIPEI_OFFSET_MS);
  const roundedMinutes = Math.ceil(shifted.getUTCMinutes() / SLOT_LENGTH_MINUTES) * SLOT_LENGTH_MINUTES;
  const earliestSlot = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), shifted.getUTCHours(), roundedMinutes) -
      PICKUP_TAIPEI_OFFSET_MS
  );

  const remainingToday = todaySlots.filter((slot) => slot.getTime() >= earliestSlot.getTime());
  if (remainingToday.length > 0) return remainingToday;

  return buildSlotsForDay(addTaipeiDays(today, 1));
}

// Whether the server (place-order's validatePickupSlot()) would still
// accept an already-chosen slot right now: strictly in the future, at
// least (minLeadMinutes - PICKUP_LEAD_GRACE_MINUTES) ahead, and on
// today's or tomorrow's Taipei date. Grid/window membership isn't
// re-checked — the slot came from buildSlotsForDay() in the first place.
function isChosenSlotStillAcceptable(slotDate) {
  const now = Date.now();
  const slotMs = slotDate.getTime();
  if (slotMs <= now) return false;
  const leadMinutes = Math.max(0, PICKUP_MIN_LEAD_MINUTES - PICKUP_LEAD_GRACE_MINUTES);
  if (slotMs < now + leadMinutes * 60 * 1000) return false;
  const dayNumber = (ms) => Math.floor((ms + PICKUP_TAIPEI_OFFSET_MS) / 86400000);
  const dayDiff = dayNumber(slotMs) - dayNumber(now);
  return dayDiff >= 0 && dayDiff <= 1;
}

// "06:15" — Taipei wall-clock time only.
function formatPickupSlotTime(slotDate) {
  const shifted = new Date(slotDate.getTime() + PICKUP_TAIPEI_OFFSET_MS);
  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
}

// "9/8 (二) 06:00" — always includes the date, not just the time,
// since the offered list may be today's remainder or tomorrow's full
// list depending on when checkout is opened; the date is what makes
// that unambiguous either way.
function formatPickupSlotLabel(slotDate) {
  const shifted = new Date(slotDate.getTime() + PICKUP_TAIPEI_OFFSET_MS);
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const weekday = PICKUP_TAIPEI_WEEKDAY_LABELS[shifted.getUTCDay()];
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${month}/${day} (${weekday}) ${hour}:${minute}`;
}

// Current `taken` count for each candidate slot, keyed by its UTC
// epoch ms (not the raw string Supabase returns, which isn't
// guaranteed to match `.toISOString()`'s exact formatting) — a slot
// with no row yet reads as 0 taken, same as the RPC itself treats it.
// On a fetch failure, returns an empty Map (every slot reads as 0/
// available) rather than blocking the picker — this is purely a
// display pre-check; place-order's reservation is the real, atomic
// enforcement regardless of what got shown here.
async function getPickupSlotTakenCounts(slots) {
  const { data, error } = await supabaseClient
    .from("pickup_slots")
    .select("slot, taken")
    .in(
      "slot",
      slots.map((s) => s.toISOString())
    );

  if (error) {
    console.error("[Pickup] slot taken-count fetch failed", error);
    return new Map();
  }

  const takenByMs = new Map();
  (data || []).forEach((row) => takenByMs.set(new Date(row.slot).getTime(), row.taken));
  return takenByMs;
}

// Rebuilds #pickup-slot-select from scratch. Called on every
// openSheet() (fresh: first available slot selected), every
// PICKUP_REFRESH_MS while the sheet is open, and after a slot_full /
// slot_invalid rejection from place-order (both with keepSelection).
// Full slots are shown, not hidden — disabled + labeled 已滿, so a
// returning customer sees why a time they remember is gone rather than
// it silently not being there. If every candidate is full, the select
// ends up with no valid value at all, which submitOrder() checks for.
//
// keepSelection: keep the customer's current choice while the server
// would still accept it (isChosenSlotStillAcceptable() — it stays in
// the list even after it drops out of the normal offering, thanks to
// the grace window) and it isn't full. Otherwise auto-select the next
// available slot and say so under the picker.
async function renderPickupSlotSection({ keepSelection = false } = {}) {
  const select = document.getElementById("pickup-slot-select");
  const previousIso = keepSelection ? select.value : "";
  const candidates = getAvailablePickupSlots();
  if (previousIso) {
    const previous = new Date(previousIso);
    if (!candidates.some((s) => s.getTime() === previous.getTime()) && isChosenSlotStillAcceptable(previous)) {
      candidates.unshift(previous); // still valid server-side — keep offering it
    }
  }
  const takenByMs = await getPickupSlotTakenCounts(candidates);

  select.innerHTML = "";
  let firstAvailableValue = null;
  let previousStillAvailable = false;
  candidates.forEach((slot) => {
    const iso = slot.toISOString();
    const taken = takenByMs.get(slot.getTime()) || 0;
    const full = taken >= MAX_ORDERS_PER_SLOT;

    const option = document.createElement("option");
    option.value = iso;
    option.textContent = formatPickupSlotLabel(slot) + (full ? "（已滿）" : "");
    option.disabled = full;
    select.appendChild(option);

    if (!full && firstAvailableValue === null) firstAvailableValue = iso;
    if (!full && previousIso && new Date(previousIso).getTime() === slot.getTime()) previousStillAvailable = true;
  });

  const noteEl = document.getElementById("pickup-slot-note");
  if (previousStillAvailable) {
    select.value = new Date(previousIso).toISOString();
    return;
  }
  if (firstAvailableValue) select.value = firstAvailableValue;
  if (previousIso && firstAvailableValue) {
    const chosen = new Date(firstAvailableValue);
    const sameDay =
      formatPickupSlotLabel(chosen).split(" ")[0] === formatPickupSlotLabel(new Date(previousIso)).split(" ")[0];
    // HH:MM normally; the full date label if it moved to another day,
    // so "06:00" can't be mistaken for today's 06:00.
    noteEl.textContent = `取餐時間已更新為 ${sameDay ? formatPickupSlotTime(chosen) : formatPickupSlotLabel(chosen)}`;
    noteEl.hidden = false;
  }
}

// Keeps the picker honest while the checkout sheet sits open — started
// by openSheet(), stopped by closeSheet(). Skips a tick while an order
// is being submitted (the submit handler refreshes itself if needed)
// or while a previous refresh is still in flight.
let pickupRefreshTimer = null;
let pickupRefreshInFlight = false;
let orderSubmitting = false;

function startPickupSlotRefresh() {
  stopPickupSlotRefresh();
  pickupRefreshTimer = setInterval(async () => {
    if (pickupRefreshInFlight || orderSubmitting) return;
    pickupRefreshInFlight = true;
    try {
      await renderPickupSlotSection({ keepSelection: true });
    } finally {
      pickupRefreshInFlight = false;
    }
  }, PICKUP_REFRESH_MS);
}

function stopPickupSlotRefresh() {
  if (pickupRefreshTimer) clearInterval(pickupRefreshTimer);
  pickupRefreshTimer = null;
}

// ------------------------------------------------------------
// Checkout sheet
// ------------------------------------------------------------

// Shared caller for every Edge Function invoked from this page (Stored
// Value's balance check/spend, the Weekday Stamp Card's progress
// check/redemption). Mirrors staff.js's similarly-purposed helper (that
// one stays Stored-Value-specific, since staff.js has no stamp-card
// calls to make) — the two files are separate, no-build-step scripts
// with no shared module to put this in, so it's intentionally
// duplicated rather than reaching for a build step (see CLAUDE.md's
// Architecture section). Uniformly returns { ok, code?, error?, ... }
// whether the function itself responded (any status — its JSON body is
// always this shape, see supabase/functions/*/index.ts) or the request
// never completed at all (offline, CORS, malformed body) — callers
// branch on `.code` the same way regardless of which case it was.
async function callEdgeFunction(name, payload) {
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
    console.error(`[EdgeFunction] ${name} request failed`, err);
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
//
// Takes the amount actually due (post any Weekday Stamp Card discount,
// not necessarily the raw cart total — see openSheet()) so the balance
// check and displayed option both reflect what would really be
// charged, not the pre-discount cart total. (Display only — place-order
// re-checks the balance and records balance_snapshot itself.)
async function renderPaymentMethodSection(amountDue) {
  const section = document.getElementById("payment-method-section");
  document.getElementById("payment-method-cash").checked = true;
  section.hidden = true;

  if (!currentMember.userId) return;
  if (amountDue <= 0) return;

  let idToken;
  try {
    idToken = liff.isLoggedIn() ? liff.getIDToken() : null;
  } catch (err) {
    idToken = null;
  }
  if (!idToken) return;

  const result = await callEdgeFunction("get-stored-value-balance", { id_token: idToken });
  if (!result.ok) return; // unreachable — no option shown

  if (result.balance < amountDue) return; // insufficient — no option shown at all, not a disabled one

  document.getElementById("payment-method-stored-value-text").textContent =
    `使用儲值支付（餘額：NT$${result.balance}）`;
  section.hidden = false;
}

// Items + stamp preview + total + payment choice — everything in the
// sheet that depends on the cart. Split out of openSheet() so removing
// a line (✕, or a line place-order rejected) re-renders these WITHOUT
// resetting the pickup slot the customer already chose. Closes the
// sheet if the cart just became empty.
async function renderSheetCart() {
  if (Object.keys(cart).length === 0) {
    closeSheet();
    return;
  }
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
      renderSheetCart();
      updateCartBar();
    });
    sheetItems.appendChild(row);
  });

  // Weekday Stamp Card preview — computeStampDiscount() is also what
  // decides whether submitOrder() asks place-order to redeem. The
  // server re-derives eligibility and the amount itself; the confirmed
  // numbers shown afterwards come from its response.
  const stampDiscount = computeStampDiscount();
  document.getElementById("stamp-banner").hidden = !stampRedemptionEligible();
  const discountRow = document.getElementById("stamp-discount-row");
  if (stampDiscount) {
    document.getElementById("stamp-discount-amount").textContent = `-NT$${stampDiscount.discount}`;
    discountRow.hidden = false;
  } else {
    discountRow.hidden = true;
  }

  const amountDue = cartTotal() - (stampDiscount ? stampDiscount.discount : 0);
  document.getElementById("sheet-total").textContent = `NT$${amountDue}`;
  await renderPaymentMethodSection(amountDue);
}

async function openSheet() {
  if (Object.keys(cart).length === 0) return;
  await renderSheetCart();
  document.getElementById("pickup-slot-note").hidden = true;
  await renderPickupSlotSection();
  updateNoteCount();
  document.getElementById("sheet-backdrop").hidden = false;
  document.getElementById("checkout-sheet").hidden = false;
  startPickupSlotRefresh();
}

function closeSheet() {
  stopPickupSlotRefresh();
  document.getElementById("sheet-backdrop").hidden = true;
  document.getElementById("checkout-sheet").hidden = true;
}

// Live "n/100" under the note box. Counted in characters (code points),
// the same way place-order counts NOTE_MAX_CHARS.
const NOTE_MAX_CHARS = 100;
function updateNoteCount() {
  const length = [...document.getElementById("order-note").value].length;
  const countEl = document.getElementById("order-note-count");
  countEl.textContent = `${length}/${NOTE_MAX_CHARS}`;
  countEl.classList.toggle("over", length > NOTE_MAX_CHARS);
}

// Plain-text summary of a PLACED order, built from place-order's
// response (never from the cart) — the Flex message's altText, which
// LINE shows in notifications/chat previews and requires on every Flex
// message. `note` is what the customer typed (the response doesn't
// echo the cleaned note back).
function buildOrderMessage(saved, note) {
  const lines = [`📋 新訂單`, ``];
  saved.items.forEach((item) => {
    const label = item.modifiers ? `${item.name}（${item.modifiers}）` : item.name;
    lines.push(`${label} x${item.qty} — NT$${item.subtotal}`);
  });
  if (saved.stamp_discount) lines.push(`集點折抵 -NT$${saved.stamp_discount}`);
  lines.push(``, `總計：NT$${saved.total}`);
  if (note) lines.push(``, `備註：${note}`);
  return lines.join("\n");
}

// Flex Message "receipt card" sent into the LINE chat after a
// successful order — same Signature Red palette as style.css, hardcoded
// here since Flex Message JSON is sent to LINE's API, not rendered by
// our own CSS, so it can't reference the custom properties directly.
// Everything on it comes from `saved`, place-order's response: the
// server-priced items/total, stamp discount, payment method, stamp
// snapshot and balance — the same values staff see and print.
function buildOrderFlexMessage(saved, note, pickupTimeText) {
  const itemRows = saved.items.map((item) => ({
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

  // Weekday Stamp Card discount, if the server applied one — without
  // this row the item lines wouldn't add up to the total below.
  const discountRows = saved.stamp_discount
    ? [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "集點折抵", size: "sm", color: "#2b211c", flex: 4 },
            { type: "text", text: `-$${saved.stamp_discount}`, size: "sm", color: "#2b211c", flex: 1, align: "end" },
          ],
        },
      ]
    : [];

  const bodyContents = [
    ...itemRows,
    ...discountRows,
    { type: "separator", margin: "md", color: "#fbdfda" },
    {
      type: "box",
      layout: "horizontal",
      margin: "md",
      contents: [
        { type: "text", text: "總計", weight: "bold", size: "md", color: "#e0132b" },
        { type: "text", text: `NT$${saved.total}`, weight: "bold", size: "md", color: "#e0132b", align: "end" },
      ],
    },
    // Payment status — unconditional (always one or the other), same
    // wording/logic as the printed receipt's buildCustomerLabelModel()
    // in print.js, so the chat card and the physical receipt can never
    // disagree about how an order was paid for.
    {
      type: "text",
      text: saved.payment_method === "stored_value" ? "已用儲值支付" : "現場付款",
      weight: "bold",
      size: "sm",
      color: "#e0132b",
      margin: "md",
    },
  ];

  // Member-only block — stamp progress + stored-value balance, both
  // omitted entirely for a guest order rather than showing empty/zero
  // placeholders. Reads straight off `saved` (place-order's response,
  // the same values written to the order row print.js's
  // receiptDataFor() reads) — one less way for the chat card and the
  // printed receipt to drift apart.
  if (saved.member_name) {
    const days = (saved.stamp_snapshot && saved.stamp_snapshot.days) || [false, false, false, false];
    const unlocked = Boolean(saved.stamp_snapshot && saved.stamp_snapshot.unlocked);
    const dayLabels = ["一", "二", "三", "四"];

    // Five small rounded chips (cornerRadius = half of width/height
    // makes a "box" render as a circle) — filled red for an earned
    // weekday, pale pink outline-ish for not-yet. Friday's chip is
    // visually distinct (gold, with a 🎁 once unlocked) since it's the
    // redemption day, not another day to earn — same idea as print.js
    // bracketing the Friday circle, just with color instead of ( ).
    const stampDots = days.map((filled, i) => ({
      type: "box",
      layout: "vertical",
      flex: 1,
      alignItems: "center",
      spacing: "xs",
      contents: [
        {
          type: "box",
          layout: "vertical",
          width: "18px",
          height: "18px",
          cornerRadius: "9px",
          backgroundColor: filled ? "#e0132b" : "#f5d9d3",
          contents: [],
        },
        { type: "text", text: dayLabels[i], size: "xxs", color: "#8a6f63", align: "center" },
      ],
    }));

    const fridayDot = {
      type: "box",
      layout: "vertical",
      flex: 1,
      alignItems: "center",
      spacing: "xs",
      contents: [
        {
          type: "box",
          layout: "vertical",
          width: "18px",
          height: "18px",
          cornerRadius: "9px",
          backgroundColor: unlocked ? "#f4b53f" : "#f5d9d3",
          justifyContent: "center",
          alignItems: "center",
          contents: unlocked ? [{ type: "text", text: "🎁", size: "xxs" }] : [],
        },
        { type: "text", text: "五", size: "xxs", color: "#8a6f63", align: "center" },
      ],
    };

    bodyContents.push(
      { type: "separator", margin: "md", color: "#fbdfda" },
      { type: "text", text: "本週集點進度", size: "xs", color: "#8a6f63", margin: "md" },
      {
        type: "box",
        layout: "horizontal",
        margin: "sm",
        spacing: "sm",
        contents: [...stampDots, fridayDot],
      }
    );

    if (saved.balance_snapshot != null) {
      bodyContents.push({
        type: "text",
        text: `儲值餘額 NT$${saved.balance_snapshot}`,
        size: "xs",
        color: "#8a6f63",
        margin: "sm",
      });
    }
  }

  return {
    type: "flex",
    altText: buildOrderMessage(saved, note) + `\n訂單編號 #${saved.short_id}`,
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
        contents: bodyContents,
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#fbefe6",
        paddingAll: "16px",
        // pickupTimeText is the slot place-order actually reserved
        // ("取餐時間：9/8 (二) 06:00"), built from saved.pickup_slot.
        contents: [{ type: "text", text: pickupTimeText, size: "xs", color: "#2b211c", wrap: true }],
      },
    },
  };
}

// Reveals the header's signed-in indicator (see .member-badge in
// style.css / index.html) — called once syncLoggedInProfile() below
// has a real profile. Tapping it opens #member-menu (see
// toggleMemberMenu() below) — 訂單紀錄/儲值紀錄/登出 today (order
// history, stamp progress via #header-stamp-widget, and Stored Value's
// own header readout all live outside this menu now — see those
// widgets' own comments).
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
  document.getElementById("header-stamp-widget").hidden = false;
  document.getElementById("header-balance-widget").hidden = false;
}

// The header's other face for the same slot .member-badge occupies —
// shown instead of the badge for anyone not currently logged in.
// Tapping it opens the benefits card (see wireUpUI()). Same [hidden]-
// override idiom as .member-badge/.cart-bar/.confirm-screen in
// style.css — never give this an unconditional `display` without one.
function showMemberPill() {
  document.getElementById("member-pill").hidden = false;
  document.getElementById("member-badge").hidden = true;
  document.getElementById("header-stamp-widget").hidden = true;
  document.getElementById("header-balance-widget").hidden = true;
}

// ------------------------------------------------------------
// Member menu — small popover anchored to #member-badge (see
// .member-menu in style.css). A bare list shell, deliberately kept at
// 3 items (訂單紀錄/儲值紀錄/登出) — stamp progress and the Stored
// Value balance itself both live in the header instead (see
// #header-stamp-widget/#header-balance-widget), reached directly
// without opening this menu at all; 儲值紀錄 here opens the
// transaction-history detail behind the header balance readout, not a
// duplicate of it.
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
  currentMember = { userId: null, profile: null };
  currentFavorites = new Set();
  favoritesUnavailable = false;
  frequentlyBoughtItemIds = null;
  stampProgress = null;
  currentHeaderBalance = null;
  showMemberPill();
  refreshFavoriteUI();
  renderMemberPicksRow();
  refreshStampWidgetUI();
  refreshBalanceWidgetUI();
}

// Current session's LINE identity (userId null = guest). Whether this
// member's orders count as test orders is decided server-side by
// place-order from feature_flags, not here.
let currentMember = { userId: null, profile: null };

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
  currentMember = { userId: profile.userId, profile };
  await syncMemberRecord();
  showMemberBadge(profile);
  await loadMemberPicks();
  await loadStampProgress();
  await loadStoredValueBalance();
}

// Refreshes this member's `members` row (display name, picture,
// last_seen_at) via the upsert-member Edge Function, which takes every
// value from the LIFF ID token's VERIFIED claims — never from anything
// the client sends. Login must still complete if this fails (it's
// bookkeeping, not a gate), so failures are only logged.
async function syncMemberRecord() {
  const idToken = currentIdToken();
  if (!idToken) {
    console.warn("[Members] no LIFF ID token — skipping upsert-member");
    return;
  }
  const result = await callEdgeFunction("upsert-member", { id_token: idToken });
  if (!result.ok) console.error("[Members] upsert-member failed — continuing login", result);
}

// This member's order history + frequently-bought item ids, from the
// member-orders Edge Function (user id taken from the verified LIFF
// token server-side). Same { ok, code, ... } shape as every other
// callEdgeFunction() result.
async function fetchMemberOrders() {
  const idToken = currentIdToken();
  if (!idToken) return { ok: false, code: "auth_invalid", error: "No LIFF ID token" };
  return callEdgeFunction("member-orders", { id_token: idToken });
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
  const result = await callMemberFavorites("list");
  if (result.ok) {
    currentFavorites = new Set(result.item_ids || []);
    favoritesUnavailable = false;
  } else {
    // Don't guess: with the real list unknown, hide the stars and the
    // 我的最愛/常買推薦 row for this session rather than show wrong ones.
    console.error("[Favorites] member-favorites list failed — hiding favourites this session", result);
    currentFavorites = new Set();
    favoritesUnavailable = true;
  }
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
    star.hidden = !favoritesUsable();
    star.classList.toggle("active", isFav);
    star.textContent = isFav ? "★" : "☆";
  });
}

// Optimistic flip first, DB write second — reverted (with a re-render)
// if the write fails, so the UI never ends up claiming a state that
// didn't actually save.
async function toggleFavorite(itemId) {
  if (!favoritesUsable()) return; // defensive — the star is [hidden] for guests / when favourites didn't load
  const wasFavorited = currentFavorites.has(itemId);

  if (wasFavorited) currentFavorites.delete(itemId);
  else currentFavorites.add(itemId);
  refreshFavoriteUI();
  await renderMemberPicksRow(); // reflect the change in 我的最愛/常買推薦 immediately too

  const result = await callMemberFavorites(wasFavorited ? "remove" : "add", itemId);
  if (!result.ok) {
    console.error("[Favorites] toggle failed, reverting", result);
    if (wasFavorited) currentFavorites.add(itemId);
    else currentFavorites.delete(itemId);
    refreshFavoriteUI();
    await renderMemberPicksRow();
    alert(wasFavorited ? "無法移除我的最愛，請稍後再試" : "無法加入我的最愛，請稍後再試");
  }
}

// ---- member-favorites Edge Function ----
// The member's user id is taken server-side from the verified LIFF ID
// token — this never sends one. Same { ok, code, ... } result shape as
// every other callEdgeFunction() call.
async function callMemberFavorites(action, itemId) {
  const idToken = currentIdToken();
  if (!idToken) return { ok: false, code: "auth_invalid", error: "No LIFF ID token" };
  const payload = { id_token: idToken, action };
  if (itemId) payload.item_id = itemId;
  return callEdgeFunction("member-favorites", payload);
}

// Set when the favourites list couldn't be loaded at login; the stars
// and the 我的最愛/常買推薦 row stay hidden until the next login.
let favoritesUnavailable = false;

// Stars (and the picks row) only for a logged-in member whose
// favourites actually loaded. Guests never see them — or trigger calls.
function favoritesUsable() {
  return Boolean(currentMember.userId) && !favoritesUnavailable;
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

  if (!favoritesUsable()) {
    wrap.hidden = true;
    row.innerHTML = "";
    return;
  }

  if (currentFavorites.size === 0 && frequentlyBoughtItemIds === null) {
    // Any failure → [] → the row simply hides (nothing to suggest).
    const result = await fetchMemberOrders();
    if (!result.ok) console.error("[Favorites] member-orders failed — hiding 常買推薦", result);
    frequentlyBoughtItemIds = result.ok && Array.isArray(result.frequent_item_ids) ? result.frequent_item_ids : [];
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

// ------------------------------------------------------------
// Weekday Stamp Card — spend NT$85+ each of Mon-Thu, redeem one free
// drink (capped at rules.stamp.freeDrinkCap, NT$35) on Friday. All of the actual unlock/redeemed
// logic lives server-side (get-stamp-progress / place-order) —
// this section only ever displays what those returned and re-derives
// the client-side "is it Friday, is there a drink in the cart to
// redeem against" questions needed to decide what to show/send, never
// the security-relevant unlocked/redeemed decision itself.
// ------------------------------------------------------------

// Result of the one get-stamp-progress call made at login (see
// loadStampProgress()) — { days:[mon,tue,wed,thu], unlocked, redeemed,
// weekStart } or null (guest, not yet loaded, or the call failed).
// Deliberately not re-fetched per checkout-sheet open, unlike Stored
// Value's balance — a day's qualifying-spend state and this week's
// redemption don't meaningfully change within one session the way a
// balance can.
let stampProgress = null;

// Today's day-of-week per Asia/Taipei, independent of the visitor's
// own device timezone — matches how the backend (get-stamp-progress /
// place-order, see _shared/taipeiWeek.ts) decides "is it
// Friday", so the client's banner/redemption attempt can't disagree
// with what the server will actually accept.
function isTaipeiFriday() {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(new Date());
  return weekday === "Fri";
}

function findItemCategory(itemId) {
  for (const cat of MENU) {
    if (cat.items.some((i) => i.id === itemId)) return cat.category;
  }
  return null;
}

// The drink line (menu.json rules.stamp.drinkCategory, i.e. 飲品) the
// free-drink redemption would apply to, if any —
// picks the most expensive one when more than one is in the cart
// (maximizes the discount; nothing in the spec says to prefer
// otherwise). null if the cart has no drink at all.
function findDrinkForStampRedemption() {
  let best = null;
  Object.values(cart).forEach((line) => {
    if (findItemCategory(line.itemId) !== MENU_RULES.stamp.drinkCategory) return;
    const item = findItem(line.itemId);
    if (!item) return;
    const unitPrice = lineUnitPrice(item, line.selection);
    if (!best || unitPrice > best.unitPrice) {
      best = { itemId: line.itemId, unitPrice };
    }
  });
  return best;
}

// Whether this checkout COULD redeem the weekly free drink right now —
// purely a client-side UI decision (show the banner, attempt the
// request). place-order re-derives unlocked/redeemed/is-it-Friday
// itself from the database regardless — this is never trusted as the
// actual security check.
function stampRedemptionEligible() {
  return Boolean(
    currentMember.userId && stampProgress && stampProgress.unlocked && !stampProgress.redeemed && isTaipeiFriday() &&
      !stampRedemptionBlocked
  );
}

// Set when place-order refuses a redemption (not_friday / not_unlocked /
// already_redeemed / no_drink), for the rest of this page session — so
// the retry goes through at full price instead of asking again and
// looping on e.g. a device clock that disagrees with the server's
// Taipei date.
let stampRedemptionBlocked = false;

// Single source for "how much would the free-drink redemption take off
// this order right now" — called identically by openSheet()'s live
// preview and submitOrder()'s actual redemption, so the number shown
// at checkout can never drift from the number actually charged.
// Returns null whenever there's nothing to redeem (not eligible, or no
// drink in the cart to apply it to).
function computeStampDiscount() {
  if (!stampRedemptionEligible()) return null;
  const drink = findDrinkForStampRedemption();
  if (!drink) return null;
  return { itemId: drink.itemId, discount: Math.min(drink.unitPrice, MENU_RULES.stamp.freeDrinkCap) };
}

// Called once right after login resolves (syncLoggedInProfile()),
// mirroring loadMemberPicks(). A failed/unreachable call leaves
// stampProgress null — stampRedemptionEligible() treats that exactly
// like "not unlocked", so a fetch hiccup just means no banner shown
// this session, never a false unlock.
async function loadStampProgress() {
  let idToken;
  try {
    idToken = liff.isLoggedIn() ? liff.getIDToken() : null;
  } catch (err) {
    idToken = null;
  }
  if (!idToken) {
    stampProgress = null;
  } else {
    const result = await callEdgeFunction("get-stamp-progress", { id_token: idToken });
    stampProgress = result.ok ? result : null;
  }
  refreshStampWidgetUI();
}

// Updates every rendered 5-circle widget (there may be more than one —
// #benefits-card and #checkout-auth-dialog both render one via
// renderBenefitRows(), same as favourites' stars appearing in more
// than one place) to match stampProgress. Guests/not-yet-loaded show
// the widget in its default all-dashed state, same division of labour
// as refreshFavoriteUI(): the build*() functions render a static
// structure, this function is the only place fill state ever changes.
function refreshStampWidgetUI() {
  const days = stampProgress ? stampProgress.days : [false, false, false, false];
  const unlocked = Boolean(stampProgress && stampProgress.unlocked);

  document.querySelectorAll(".stamp-circle[data-day]").forEach((circle) => {
    const isFilled = Boolean(days[Number(circle.dataset.day)]);
    circle.classList.toggle("filled", isFilled);
  });
  document.querySelectorAll(".stamp-circle-fri").forEach((circle) => {
    circle.classList.toggle("unlocked", unlocked);
  });

  // #benefits-login only makes sense for a not-yet-logged-in visitor —
  // reusing #benefits-card for a logged-in member (opened by tapping
  // #header-stamp-widget, see wireUpUI()) would otherwise show a
  // redundant "connect with LINE" button to someone already connected.
  document.getElementById("benefits-login").hidden = Boolean(currentMember.userId);
}

// ------------------------------------------------------------
// Order history — member-only, reached via #member-menu-order-history
// (member-menu popover). Read-only: no reorder/re-add-to-cart action.
// Fetched fresh on every open rather than cached like stampProgress/
// currentFavorites — unlike those, there's no other event in this page
// session that would need to keep it in sync, so there's nothing
// gained by holding onto it between opens.
// ------------------------------------------------------------

// "9月7日 上午1:53" style — Asia/Taipei explicitly, matching the
// Weekday Stamp Card's own timezone handling, not the visitor's device
// timezone (see isTaipeiFriday() above for the same reasoning). Shared
// by order history and the Stored Value transaction history below —
// both are "when did this member-scoped thing happen" timestamps
// wanting the identical format, not two features that happen to look
// alike.
function formatMemberDateTime(isoString) {
  return new Date(isoString).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// One order's row — name+qty per line (reusing the exact text shape
// staff.js's buildCard() already uses for the same order.items data,
// just without staff.js's own DOM/print concerns), total, the same
// 集點折抵 wording print.js uses when stamp_discount applied, and the
// same 現場付款/已用儲值支付 wording the printed receipt uses (this is
// a record of what happened, so the retrospective receipt wording fits
// better here than checkout's forward-looking "使用儲值支付").
function buildOrderHistoryItem(order) {
  const item = document.createElement("div");
  item.className = "order-history-item";

  const header = document.createElement("div");
  header.className = "order-history-item-header";
  header.innerHTML = `
    <span class="order-history-date">${formatMemberDateTime(order.created_at)}</span>
    <span class="order-history-total">NT$${order.total}</span>
  `;
  item.appendChild(header);

  const lines = document.createElement("div");
  lines.className = "order-history-lines";
  (order.items || []).forEach((line) => {
    const div = document.createElement("div");
    div.textContent = line.modifiers ? `${line.name}（${line.modifiers}）x${line.qty}` : `${line.name} x${line.qty}`;
    lines.appendChild(div);
  });
  item.appendChild(lines);

  if (order.stamp_discount > 0) {
    const discount = document.createElement("div");
    discount.className = "order-history-discount";
    discount.textContent = `集點折抵 -NT$${order.stamp_discount}`;
    item.appendChild(discount);
  }

  const meta = document.createElement("div");
  meta.className = "order-history-meta";
  meta.textContent = order.payment_method === "stored_value" ? "已用儲值支付" : "現場付款";
  item.appendChild(meta);

  return item;
}

async function openOrderHistorySheet() {
  document.getElementById("order-history-backdrop").hidden = false;
  document.getElementById("order-history-sheet").hidden = false;

  const rows = document.getElementById("order-history-rows");
  rows.innerHTML = `<p class="order-history-empty">載入中…</p>`;

  const result = await fetchMemberOrders();
  if (!result.ok) {
    console.error("[OrderHistory] member-orders failed", result);
    rows.innerHTML =
      result.code === "auth_invalid"
        ? `<p class="order-history-empty">登入已過期，請重新開啟頁面後再試</p>`
        : `<p class="order-history-empty">訂單紀錄載入失敗，請稍後再試</p>`;
    return;
  }
  const orders = result.orders || [];

  if (orders.length === 0) {
    rows.innerHTML = `<p class="order-history-empty">尚無訂單紀錄</p>`;
    return;
  }

  rows.innerHTML = "";
  orders.forEach((order) => rows.appendChild(buildOrderHistoryItem(order)));
}

function closeOrderHistorySheet() {
  document.getElementById("order-history-backdrop").hidden = true;
  document.getElementById("order-history-sheet").hidden = true;
}

// ------------------------------------------------------------
// Stored Value — header balance readout + transaction history.
//
// The balance itself was never actually shown anywhere in this app
// before this section: the "future entries" comment on #member-menu
// (index.html) listed it as something still to come, and the only
// real number a member ever saw was buried inside the checkout
// sheet's payment-method radio label ("使用儲值支付（餘額：NT$X）"),
// which is itself hidden whenever the balance doesn't cover the
// current total — never a general-purpose "what's my balance" view.
// This section is that view: an always-visible header readout (shown
// even at NT$0, unlike checkout's conditional one) plus a dedicated
// transaction history sheet, both reusing the same
// verified-LIFF-ID-token Edge Function pattern as checkout's own
// get-stored-value-balance call.
// ------------------------------------------------------------

// Current member's balance as last fetched, for the header readout —
// { balance:number } once loaded, null for a guest, before the first
// fetch, or if the fetch failed (shown as "NT$—", not a stale/guessed
// number — see refreshBalanceWidgetUI()). Scoped to
// "what's shown in the header right now" and only changes at login or
// after an order actually spends stored value (see submitOrder()).
let currentHeaderBalance = null;

// Called once right after login resolves (syncLoggedInProfile()),
// mirroring loadStampProgress()/loadMemberPicks() — not re-fetched on
// every render, since nothing changes it within a session except an
// order that actually pays with stored value, which updates
// currentHeaderBalance directly instead of re-fetching (see
// submitOrder()).
async function loadStoredValueBalance() {
  let idToken;
  try {
    idToken = liff.isLoggedIn() ? liff.getIDToken() : null;
  } catch (err) {
    idToken = null;
  }
  if (!idToken) {
    currentHeaderBalance = null;
  } else {
    const result = await callEdgeFunction("get-stored-value-balance", { id_token: idToken });
    currentHeaderBalance = result.ok ? result.balance : null;
  }
  refreshBalanceWidgetUI();
}

// Updates the header readout to match currentHeaderBalance — same
// division of labour as refreshStampWidgetUI(): loadStoredValueBalance()
// decides *what* the number is, this only ever renders it. A failed/
// not-yet-loaded fetch shows "NT$—" rather than "NT$0", so a real zero
// balance (a real, known fact) can never be confused with "couldn't
// reach the server" (an unknown one).
function refreshBalanceWidgetUI() {
  document.getElementById("header-balance-amount").textContent =
    currentHeaderBalance != null ? `NT$${currentHeaderBalance}` : "NT$—";
}

// 儲值 (credit) vs 折抵/消費 (debit) — 'refund' included even though
// nothing currently inserts that type (see stored_value_transactions'
// type check constraint in README.md) so a future refund flow doesn't
// silently fall back to showing a raw "refund" string.
const TRANSACTION_TYPE_LABELS = {
  topup: "儲值",
  deduction: "折抵/消費",
  refund: "退款",
};

// One transaction row — type + signed amount (amount is already
// signed in the database, e.g. -45 for a deduction, see
// spend_stored_value()/topup_stored_value() in README.md, so this
// never re-derives the sign from `type` itself) + timestamp. No order
// itemization here by design (see get-stored-value-transactions) —
// order history's own sheet already covers what was bought.
function buildTransactionItem(tx) {
  const item = document.createElement("div");
  item.className = "transaction-item";

  const left = document.createElement("div");
  const typeEl = document.createElement("div");
  typeEl.className = "transaction-type";
  typeEl.textContent = TRANSACTION_TYPE_LABELS[tx.type] || tx.type;
  const dateEl = document.createElement("div");
  dateEl.className = "transaction-date";
  dateEl.textContent = formatMemberDateTime(tx.created_at);
  left.appendChild(typeEl);
  left.appendChild(dateEl);

  const amountEl = document.createElement("div");
  const isPositive = tx.amount >= 0;
  amountEl.className = `transaction-amount ${isPositive ? "positive" : "negative"}`;
  // Sign goes before "NT$", not folded into the number itself (e.g.
  // "-NT$45", not "NT$-45") — matches the stamp discount preview's own
  // "-NT$${discount}" formatting elsewhere in this file.
  amountEl.textContent = `${isPositive ? "+" : "-"}NT$${Math.abs(tx.amount)}`;

  item.appendChild(left);
  item.appendChild(amountEl);
  return item;
}

async function openTransactionsSheet() {
  document.getElementById("transactions-backdrop").hidden = false;
  document.getElementById("transactions-sheet").hidden = false;

  const rows = document.getElementById("transactions-rows");
  rows.innerHTML = `<p class="order-history-empty">載入中…</p>`;

  let idToken;
  try {
    idToken = liff.isLoggedIn() ? liff.getIDToken() : null;
  } catch (err) {
    idToken = null;
  }

  const result = idToken
    ? await callEdgeFunction("get-stored-value-transactions", { id_token: idToken })
    : { ok: false, code: "unknown", error: "No ID token available" };

  if (!result.ok) {
    console.error("[StoredValue] get-stored-value-transactions failed", result);
    rows.innerHTML = `<p class="order-history-empty">載入失敗，請稍後再試</p>`;
    return;
  }

  if (result.transactions.length === 0) {
    rows.innerHTML = `<p class="order-history-empty">尚無儲值紀錄</p>`;
    return;
  }

  rows.innerHTML = "";
  result.transactions.forEach((tx) => rows.appendChild(buildTransactionItem(tx)));
}

function closeTransactionsSheet() {
  document.getElementById("transactions-backdrop").hidden = true;
  document.getElementById("transactions-sheet").hidden = true;
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

// Single source for the member-benefit rows shown identically in
// #benefits-card and the checkout auth dialog (#checkout-auth-dialog)
// — edit the copy here, not in index.html, so the two can't drift
// apart. The old "累積點數" (reward points) placeholder caption is gone;
// the Weekday Stamp Card replaced that concept with a real widget
// (buildStampCardRow() below) instead of a placeholder line, so only
// the other two benefits stay as plain {placeholder, caption} rows.
// The Weekday Stamp Card's own 5-circle graphic now lives in the
// header (#header-stamp-widget, next to the member badge — see
// index.html/refreshStampWidgetUI()), not here — this caption is all
// that's left of it in 會員福利, kept as plain text (same shape as the
// other two rows) since a first-time member still needs to learn what
// the header dots mean somewhere, just not via a second copy of the
// graphic itself.
const MEMBER_BENEFIT_CAPTIONS = [
  "週一至週四單日消費滿NT$85，週五即可兌換一杯免費飲品！",
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

  const selectedSlotIso = document.getElementById("pickup-slot-select").value;
  if (!selectedSlotIso) {
    // Every candidate slot was full when renderPickupSlotSection() last
    // ran — nothing to reserve against.
    alert("目前無可預約的取餐時段，請稍後再試");
    return;
  }

  // Cart keys in request order, so an error's `line` index (see
  // place-order's pricing errors) maps back to the cart line to remove.
  const lineKeys = Object.keys(cart);
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

  // ONE request: place-order prices every line from menu.json itself,
  // verifies the LINE login, decides the stamp discount, validates the
  // slot and note, then reserves the slot, assigns the order number,
  // spends stored value, records the redemption and inserts the order
  // in a single all-or-nothing transaction. Nothing here is trusted for
  // money — the client only says what's in the cart and what the
  // customer chose.
  const request = {
    menu_version: MENU_VERSION,
    items: lineKeys.map((key) => ({ itemId: cart[key].itemId, qty: cart[key].qty, selection: cart[key].selection })),
    note,
    pickup_slot: selectedSlotIso,
    payment_method: paymentMethod,
    redeem_stamp: Boolean(computeStampDiscount()),
  };
  const idToken = currentIdToken();
  if (idToken) request.id_token = idToken;

  const submitBtn = document.getElementById("submit-order");
  submitBtn.disabled = true;
  submitBtn.textContent = "送出中…";
  orderSubmitting = true;

  try {
    const saved = await callEdgeFunction("place-order", request);
    if (!saved.ok) {
      await handlePlaceOrderFailure(saved, lineKeys);
      return;
    }

    // From here on the order exists. Everything shown or sent below
    // comes from the response (server-priced items/total, the slot it
    // actually reserved, the order number), never from the cart.
    const pickupTimeText = `取餐時間：${formatPickupSlotLabel(new Date(saved.pickup_slot))}`;
    applyOrderResultToMemberWidgets(saved);

    try {
      // Also drop a copy into the LINE chat so it's visible there too
      // (optional — remove this block if you'd rather rely on the
      // staff tablet only).
      if (liff.isInClient()) {
        await liff.sendMessages([buildOrderFlexMessage(saved, note, pickupTimeText)]);
      }
    } catch (err) {
      console.error("LIFF sendMessages failed (order already saved, continuing):", err);
    }

    document.getElementById("confirm-wait").textContent = pickupTimeText;
    document.getElementById("confirm-order-id").textContent = `訂單編號 #${saved.short_id}`;

    closeSheet();
    Object.keys(cart).forEach((id) => delete cart[id]);
    document.getElementById("order-note").value = "";
    updateNoteCount();
    renderMenu();
    updateCartBar();
    document.getElementById("confirm-screen").hidden = false;
  } finally {
    orderSubmitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "送出訂單";
  }
}

// The current LIFF ID token, or null (guest, or LIFF unavailable).
function currentIdToken() {
  try {
    return liff.isLoggedIn() ? liff.getIDToken() : null;
  } catch (err) {
    return null;
  }
}

// After a successful MEMBER order, bring the header widgets up to date
// from the response instead of re-fetching: the stamp snapshot already
// includes this order (today's circle ticks if it reached the
// threshold), and balance_snapshot is the balance after this order (or
// the current balance, for a cash-paying member). Guests have neither.
function applyOrderResultToMemberWidgets(saved) {
  if (saved.stamp_snapshot) {
    stampProgress = {
      ...(stampProgress || {}),
      days: saved.stamp_snapshot.days,
      unlocked: saved.stamp_snapshot.unlocked,
      redeemed: Boolean((stampProgress && stampProgress.redeemed) || saved.stamp_discount > 0),
    };
    refreshStampWidgetUI();
  }
  if (saved.balance_snapshot != null) {
    currentHeaderBalance = saved.balance_snapshot;
    refreshBalanceWidgetUI();
  }
}

// place-order is all-or-nothing: on ANY error response nothing was
// reserved, charged, redeemed or saved. Every message below says so —
// except "network", where the request may have reached the server and
// succeeded even though no response came back.
const ORDER_NOT_CHARGED = "訂單未送出，未扣款。";

// Request/cart shape problems — the cart no longer matches the menu or
// the server's limits. Clear the offending line when place-order says
// which one (`line`), otherwise ask for a reload.
const CART_VALIDATION_CODES = new Set([
  "empty_order",
  "too_many_lines",
  "invalid_line",
  "invalid_qty",
  "unknown_item",
  "invalid_selection",
  "unknown_group",
  "group_not_on_item",
  "unknown_option",
  "unknown_addon",
  "duplicate_id",
  "thickness_invalid",
  "invalid_request",
  "invalid_input",
]);

async function handlePlaceOrderFailure(result, lineKeys) {
  const code = result.code;
  console.error("[Checkout] place-order failed", result);

  switch (code) {
    case "menu_outdated":
      alert(`菜單已更新，頁面將重新載入。${ORDER_NOT_CHARGED}`);
      // Cart + note survive the reload (lines that no longer exist in
      // the new menu are dropped on restore).
      persistCartForLoginRedirect();
      location.reload();
      return;

    case "slot_full":
      alert(`該取餐時段已額滿，請重新選擇取餐時間。${ORDER_NOT_CHARGED}`);
      await renderPickupSlotSection({ keepSelection: true }); // full slot now disabled; next one auto-selected with a note
      return;

    case "slot_invalid":
      alert(`此取餐時間已無法預約，請重新選擇取餐時間。${ORDER_NOT_CHARGED}`);
      document.getElementById("pickup-slot-note").hidden = true;
      await renderPickupSlotSection(); // fresh list — don't keep a slot the server just refused
      return;

    case "insufficient_funds":
      alert(`儲值餘額不足，請改用現場付款。${ORDER_NOT_CHARGED}`);
      document.getElementById("payment-method-cash").checked = true;
      document.getElementById("payment-method-section").hidden = true;
      loadStoredValueBalance(); // refresh the header readout
      return;

    case "already_redeemed":
    case "not_unlocked":
    case "not_friday":
    case "no_drink": {
      const reason = {
        already_redeemed: "本週免費飲品已兌換過",
        not_unlocked: "本週集點尚未完成",
        not_friday: "免費飲品僅限週五兌換",
        no_drink: "購物車中沒有可兌換的飲品",
      }[code];
      alert(`${reason}，將改以原價計算，請確認金額後再送出。${ORDER_NOT_CHARGED}`);
      stampRedemptionBlocked = true;
      if (code === "already_redeemed" && stampProgress) stampProgress.redeemed = true;
      refreshStampWidgetUI();
      await renderSheetCart(); // discount row gone, total back to full price
      return;
    }

    case "guest_not_allowed":
      alert(`使用儲值或集點需先登入LINE會員。${ORDER_NOT_CHARGED}`);
      openBenefitsCard();
      return;

    case "auth_invalid":
      if (confirm(`LINE登入已過期，請重新登入。${ORDER_NOT_CHARGED}\n\n要現在重新登入嗎？`)) {
        reloginWithLine();
      }
      return;

    case "auth_unavailable":
      alert(`LINE連線忙碌中，請稍後再試。${ORDER_NOT_CHARGED}`);
      return;

    case "note_too_long":
      alert(`備註最多${NOTE_MAX_CHARS}字，請縮短後再送出。${ORDER_NOT_CHARGED}`);
      document.getElementById("order-note").focus();
      return;

    case "network":
      // The ONLY case where we can't promise nothing happened: the
      // request may have been processed before the connection dropped.
      alert("網路連線不穩，無法確認訂單是否已送出。為避免重複下單，會員請先查看「訂單紀錄」，或直接聯繫店家確認。");
      return;
  }

  if (CART_VALIDATION_CODES.has(code)) {
    const key = Number.isInteger(result.line) ? lineKeys[result.line] : null;
    if (key && cart[key]) {
      delete cart[key];
      updateCartBar();
      await renderSheetCart();
      alert(`購物車內容需要更新，已移除一項無法訂購的餐點，請確認後再送出。${ORDER_NOT_CHARGED}`);
    } else {
      alert(`購物車內容需要更新，請重新整理頁面後再試。${ORDER_NOT_CHARGED}`);
    }
    return;
  }

  alert(`送出失敗，請稍後再試。${ORDER_NOT_CHARGED}`);
}

// auth_invalid: the LIFF ID token was rejected (typically expired).
// Log out and back in for a fresh one, keeping the cart and note across
// the reload. Inside LINE, liff.init() logs back in automatically on
// reload; outside LINE, liff.login() redirects to LINE's login page.
function reloginWithLine() {
  persistCartForLoginRedirect();
  try {
    liff.logout();
  } catch (err) {
    console.error("[Login] liff.logout() failed", err);
  }
  if (liff.isInClient()) {
    location.reload();
  } else {
    liff.login();
  }
}

function wireUpUI() {
  wireSearchInput();

  document.getElementById("cart-bar").addEventListener("click", openSheet);
  document.getElementById("close-sheet").addEventListener("click", closeSheet);
  document.getElementById("sheet-backdrop").addEventListener("click", closeSheet);
  document.getElementById("submit-order").addEventListener("click", submitOrder);
  document.getElementById("order-note").addEventListener("input", updateNoteCount);
  document.getElementById("pickup-slot-select").addEventListener("change", () => {
    document.getElementById("pickup-slot-note").hidden = true; // the customer chose for themselves
  });
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
  document.getElementById("header-stamp-widget").addEventListener("click", openBenefitsCard); // the shared 會員福利 explainer (集點/儲值/我的最愛 captions) — not purely inert
  document.getElementById("member-menu-order-history").addEventListener("click", () => {
    closeMemberMenu();
    openOrderHistorySheet();
  });
  document.getElementById("order-history-close").addEventListener("click", closeOrderHistorySheet);
  document.getElementById("order-history-backdrop").addEventListener("click", closeOrderHistorySheet);
  document.getElementById("header-balance-widget").addEventListener("click", openTransactionsSheet); // same 儲值紀錄 view the member-menu entry opens — not purely inert
  document.getElementById("member-menu-transactions").addEventListener("click", () => {
    closeMemberMenu();
    openTransactionsSheet();
  });
  document.getElementById("transactions-close").addEventListener("click", closeTransactionsSheet);
  document.getElementById("transactions-backdrop").addEventListener("click", closeTransactionsSheet);
}

async function init() {
  try {
    await loadMenu();
  } catch (err) {
    // Nothing on this page works without the menu (prices, options,
    // pickup slots) — show the error and stop here. A persisted
    // login-redirect cart is left in sessionStorage untouched, so a
    // reload that does load the menu can still restore it.
    console.error("[Menu] failed to load menu.json", err);
    showMenuLoadError();
    return;
  }

  restoreCartAfterLoginRedirect(); // after loadMenu() (validates lines against it), before the first render, so restored quantities show immediately, not after a flash of empty
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