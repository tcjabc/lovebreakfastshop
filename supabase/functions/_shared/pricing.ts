// ============================================================
// pricing — server-side port of app.js's lineBasePrice() /
// lineUnitPrice() / describeSelection(), driven by the same menu.json
// the customer app fetches. place-order prices every line with this and
// never trusts a client-sent price or description.
//
// FAITHFUL PORT: for any selection app.js can produce, unitPrice and
// modifiers here must equal what the app shows. In particular:
//   * multi-group option ids are described in the ORDER SENT (tick
//     order), like the client — not menu order;
//   * add-ons are described in MENU order, like the client;
//   * a single group's first option is the default and is never
//     described; a missing single-group pick means that default;
//   * a thick-capable item describes "厚片" for "thick" and "吐司" for
//     anything else (including null), like the client;
//   * selection null prices at the base price with no description,
//     exactly as lineUnitPrice/describeSelection do for null.
// Where the client silently tolerates something (duplicate ids, out-of-
// range values), this REJECTS instead — the server is the gatekeeper.
//
// Keep in sync with app.js if either side's pricing ever changes.
// ============================================================

export interface MenuOption {
  id: string;
  label: string;
  price: number;
}

export interface MenuGroup {
  label: string;
  type: "single" | "multi";
  options: MenuOption[];
}

export interface MenuItem {
  id: string;
  name: string;
  nameEn?: string;
  price?: number;
  priceThin?: number | null;
  priceThick?: number | null;
  modifierGroups?: string[];
  addons?: MenuOption[];
}

export interface MenuCategory {
  category: string;
  items: MenuItem[];
}

export interface MenuRules {
  stamp: { drinkCategory: string; freeDrinkCap: number };
  pickup: {
    open: string;
    close: string;
    slotMinutes: number;
    perSlot: number;
    minLeadMinutes: number;
    timezone: string;
  };
}

export interface MenuData {
  version: string;
  shopInfo: { name: string; nameEn?: string; pickupNote?: string };
  rules: MenuRules;
  modifierGroups: Record<string, MenuGroup>;
  menu: MenuCategory[];
}

// Cart v2 selection shape (see the comment on `cart` in app.js).
export interface Selection {
  thickness?: "thin" | "thick" | null;
  groups?: Record<string, string | string[]>;
  addons?: string[];
}

export interface RequestLine {
  itemId: string;
  qty: number;
  selection: Selection | null;
}

export interface PricedLine {
  id: string;
  name: string;
  modifiers: string; // "" when nothing to describe
  qty: number;
  unitPrice: number;
  subtotal: number;
  category: string;
}

export type PricingErrorCode =
  | "empty_order"
  | "too_many_lines"
  | "invalid_line"
  | "invalid_qty"
  | "unknown_item"
  | "invalid_selection"
  | "unknown_group"
  | "group_not_on_item"
  | "unknown_option"
  | "unknown_addon"
  | "duplicate_id"
  | "thickness_invalid";

export class PricingError extends Error {
  code: PricingErrorCode;
  line: number | null; // 0-based index into the request's items, when it's about one line
  constructor(code: PricingErrorCode, message: string, line: number | null = null) {
    super(message);
    this.name = "PricingError";
    this.code = code;
    this.line = line;
  }
}

export const MAX_LINES = 30;
export const MAX_QTY = 20;

function findItem(menu: MenuData, itemId: string): { item: MenuItem; category: string } | null {
  for (const cat of menu.menu) {
    const item = cat.items.find((i) => i.id === itemId);
    if (item) return { item, category: cat.category };
  }
  return null;
}

function itemHasOptions(item: MenuItem): boolean {
  return !!(
    (item.modifierGroups && item.modifierGroups.length) ||
    (item.addons && item.addons.length) ||
    item.priceThin != null ||
    item.priceThick != null
  );
}

function hasDuplicates(ids: string[]): boolean {
  return new Set(ids).size !== ids.length;
}

// Validates one line's selection against its item. Throws PricingError;
// returns nothing — pricing/description below assume it passed.
function validateSelection(menu: MenuData, item: MenuItem, selection: unknown, line: number): void {
  if (selection === null) return; // base price, no description — see header
  if (typeof selection !== "object" || Array.isArray(selection)) {
    throw new PricingError("invalid_selection", `selection must be an object or null`, line);
  }
  if (!itemHasOptions(item)) {
    throw new PricingError("invalid_selection", `item ${item.id} has no options; selection must be null`, line);
  }
  const sel = selection as Record<string, unknown>;
  const allowedKeys = new Set(["thickness", "groups", "addons"]);
  for (const key of Object.keys(sel)) {
    if (!allowedKeys.has(key)) throw new PricingError("invalid_selection", `unknown selection field "${key}"`, line);
  }

  // thickness
  const thickness = sel.thickness ?? null;
  if (thickness !== null && thickness !== "thin" && thickness !== "thick") {
    throw new PricingError("thickness_invalid", `thickness must be "thin", "thick" or null`, line);
  }
  const hasThinThick = item.priceThin != null || item.priceThick != null;
  if (thickness !== null && !hasThinThick) {
    throw new PricingError("thickness_invalid", `item ${item.id} has no thin/thick pricing`, line);
  }
  if (thickness === "thick" && item.priceThick == null) {
    throw new PricingError("thickness_invalid", `item ${item.id} has no thick option`, line);
  }

  // groups
  const groups = sel.groups ?? {};
  if (typeof groups !== "object" || groups === null || Array.isArray(groups)) {
    throw new PricingError("invalid_selection", `groups must be an object`, line);
  }
  const itemGroups = item.modifierGroups || [];
  for (const [groupId, picked] of Object.entries(groups as Record<string, unknown>)) {
    const group = menu.modifierGroups[groupId];
    if (!group) throw new PricingError("unknown_group", `unknown modifier group "${groupId}"`, line);
    if (!itemGroups.includes(groupId)) {
      throw new PricingError("group_not_on_item", `group "${groupId}" is not offered on item ${item.id}`, line);
    }
    const known = (id: unknown) => typeof id === "string" && group.options.some((o) => o.id === id);
    if (group.type === "multi") {
      if (!Array.isArray(picked)) {
        throw new PricingError("invalid_selection", `group "${groupId}" is multi-choice; expected an array of option ids`, line);
      }
      for (const id of picked) {
        if (!known(id)) throw new PricingError("unknown_option", `unknown option "${id}" in group "${groupId}"`, line);
      }
      if (hasDuplicates(picked as string[])) {
        throw new PricingError("duplicate_id", `duplicate option id in group "${groupId}"`, line);
      }
    } else {
      if (picked === null) continue; // same as missing → default
      if (typeof picked !== "string") {
        throw new PricingError("invalid_selection", `group "${groupId}" is single-choice; expected one option id`, line);
      }
      if (!known(picked)) throw new PricingError("unknown_option", `unknown option "${picked}" in group "${groupId}"`, line);
    }
  }

  // addons
  const addons = sel.addons ?? [];
  if (!Array.isArray(addons)) throw new PricingError("invalid_selection", `addons must be an array`, line);
  const addonIds = (item.addons || []).map((a) => a.id);
  for (const id of addons) {
    if (typeof id !== "string" || !addonIds.includes(id)) {
      throw new PricingError("unknown_addon", `unknown add-on "${id}" for item ${item.id}`, line);
    }
  }
  if (hasDuplicates(addons as string[])) {
    throw new PricingError("duplicate_id", `duplicate add-on id for item ${item.id}`, line);
  }
}

// ---- ports of app.js (selection already validated) ------------------

function groupOption(group: MenuGroup, optionId: string): MenuOption {
  const option = group.options.find((o) => o.id === optionId);
  if (!option) throw new PricingError("unknown_option", `unknown option id "${optionId}"`);
  return option;
}

function singlePick(group: MenuGroup, picked: string | string[] | null | undefined): MenuOption {
  return groupOption(group, picked != null ? (picked as string) : group.options[0].id);
}

function multiPicks(group: MenuGroup, picked: string | string[] | null | undefined): MenuOption[] {
  return [...new Set((picked as string[]) || [])].map((id) => groupOption(group, id));
}

function selectedAddons(item: MenuItem, selection: Selection): MenuOption[] {
  const ids = new Set(selection.addons || []);
  return (item.addons || []).filter((addon) => ids.has(addon.id));
}

function lineBasePrice(item: MenuItem, selection: Selection | null): number {
  if (item.priceThin != null || item.priceThick != null) {
    return (selection && selection.thickness === "thick" ? item.priceThick : item.priceThin) as number;
  }
  return item.price as number;
}

function lineUnitPrice(menu: MenuData, item: MenuItem, selection: Selection | null): number {
  let total = lineBasePrice(item, selection);
  if (!selection) return total;

  (item.modifierGroups || []).forEach((groupId) => {
    const group = menu.modifierGroups[groupId];
    const picked = (selection.groups || {})[groupId];
    if (group.type === "multi") {
      multiPicks(group, picked).forEach((option) => (total += option.price));
    } else {
      total += singlePick(group, picked).price;
    }
  });

  selectedAddons(item, selection).forEach((addon) => (total += addon.price));

  return total;
}

function describeSelection(menu: MenuData, item: MenuItem, selection: Selection | null): string {
  if (!selection) return "";
  const parts: string[] = [];

  if (item.priceThick != null) {
    parts.push(selection.thickness === "thick" ? "厚片" : "吐司");
  }

  (item.modifierGroups || []).forEach((groupId) => {
    const group = menu.modifierGroups[groupId];
    const picked = (selection.groups || {})[groupId];
    if (group.type === "multi") {
      multiPicks(group, picked).forEach((option) => parts.push(`+${option.label}`));
    } else {
      const option = singlePick(group, picked);
      if (option !== group.options[0]) parts.push(option.label);
    }
  });

  selectedAddons(item, selection).forEach((addon) => parts.push(`+${addon.label}`));

  return parts.join("、");
}

// ---- public API -------------------------------------------------------

/** Validates and prices one request line. Throws PricingError. */
export function priceLine(menu: MenuData, requestLine: unknown, lineIndex = 0): PricedLine {
  if (!requestLine || typeof requestLine !== "object" || Array.isArray(requestLine)) {
    throw new PricingError("invalid_line", "each item must be an object { itemId, qty, selection }", lineIndex);
  }
  const { itemId, qty, selection } = requestLine as Record<string, unknown>;
  if (typeof itemId !== "string") throw new PricingError("invalid_line", "itemId must be a string", lineIndex);
  if (!Number.isInteger(qty) || (qty as number) < 1 || (qty as number) > MAX_QTY) {
    throw new PricingError("invalid_qty", `qty must be an integer 1–${MAX_QTY}`, lineIndex);
  }

  const found = findItem(menu, itemId);
  if (!found) throw new PricingError("unknown_item", `unknown item "${itemId}"`, lineIndex);
  const { item, category } = found;

  const sel = selection === undefined ? null : selection;
  validateSelection(menu, item, sel, lineIndex);

  const unitPrice = lineUnitPrice(menu, item, sel as Selection | null);
  return {
    id: item.id,
    name: item.name,
    modifiers: describeSelection(menu, item, sel as Selection | null),
    qty: qty as number,
    unitPrice,
    subtotal: unitPrice * (qty as number),
    category,
  };
}

/** Validates and prices a whole order's lines. Throws PricingError. */
export function priceLines(menu: MenuData, requestLines: unknown): PricedLine[] {
  if (!Array.isArray(requestLines) || requestLines.length === 0) {
    throw new PricingError("empty_order", "items must be a non-empty array");
  }
  if (requestLines.length > MAX_LINES) {
    throw new PricingError("too_many_lines", `at most ${MAX_LINES} lines per order`);
  }
  return requestLines.map((line, i) => priceLine(menu, line, i));
}

/** The exact shape orders.items has always stored (staff/receipts/history read it). */
export function toOrderItems(lines: PricedLine[]) {
  return lines.map(({ id, name, modifiers, qty, subtotal }) => ({ id, name, modifiers, qty, subtotal }));
}
