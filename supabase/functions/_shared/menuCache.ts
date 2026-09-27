// ============================================================
// menuCache — the live menu.json (secret MENU_URL), cached in memory
// for 60s per isolate. Used by member-orders to drop item ids that are
// no longer on the menu.
//
// place-order has its own copy of this logic (plus its menu_version
// check); it can switch to this module the next time it's redeployed.
// ============================================================

import type { MenuData } from "./pricing.ts";

const MENU_CACHE_MS = 60 * 1000;
let cache: { data: MenuData; fetchedAt: number } | null = null;

export async function getCachedMenu(): Promise<MenuData> {
  if (cache && Date.now() - cache.fetchedAt < MENU_CACHE_MS) return cache.data;
  const url = Deno.env.get("MENU_URL");
  if (!url) throw new Error("MENU_URL is not set for this Edge Function");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`menu.json fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!data || typeof data.version !== "string" || !Array.isArray(data.menu)) {
    throw new Error("menu.json is missing required fields");
  }
  cache = { data, fetchedAt: Date.now() };
  return data;
}

/** Every item id currently on the menu. */
export function menuItemIds(menu: MenuData): Set<string> {
  const ids = new Set<string>();
  for (const cat of menu.menu) for (const item of cat.items) ids.add(item.id);
  return ids;
}
