// ============================================================
// pickupSlot — server-side check that a requested pickup slot is one
// the customer app could legitimately have offered. Used by
// place-order before it reserves anything.
//
// Mirrors app.js's getAvailablePickupSlots(), driven by menu.json's
// rules.pickup: on the slotMinutes grid, inside [open, close) Taipei
// time, on today's or tomorrow's Taipei date (the only two days the app
// ever offers), strictly in the future, and at least
// (minLeadMinutes - SLOT_LEAD_GRACE_MINUTES) from now.
//
// Fixed UTC+8 like _shared/taipeiWeek.ts and app.js (Taiwan has no DST).
// ============================================================

import type { MenuRules } from "./pricing.ts";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// The app offers slots >= now + minLeadMinutes when the checkout sheet
// OPENS; a customer who picks the earliest one and takes a few minutes
// to submit shouldn't be rejected for it. Doesn't relax "in the future".
export const SLOT_LEAD_GRACE_MINUTES = 5;

function clockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Returns the slot as a Date if valid, otherwise null. `now` is a
 * parameter only so the rule can be tested at fixed times.
 */
export function validatePickupSlot(
  iso: unknown,
  rules: MenuRules["pickup"],
  now: number = Date.now()
): Date | null {
  if (typeof iso !== "string") return null;
  const slot = new Date(iso);
  if (Number.isNaN(slot.getTime())) return null;

  // On the grid, inside the window (Taipei wall-clock time).
  const shifted = new Date(slot.getTime() + TAIPEI_OFFSET_MS);
  if (shifted.getUTCSeconds() !== 0 || shifted.getUTCMilliseconds() !== 0) return null;
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const open = clockMinutes(rules.open);
  const close = clockMinutes(rules.close);
  if (minutes < open || minutes >= close || (minutes - open) % rules.slotMinutes !== 0) return null;

  // In the future, with the (grace-reduced) lead time.
  if (slot.getTime() <= now) return null;
  const leadMinutes = Math.max(0, rules.minLeadMinutes - SLOT_LEAD_GRACE_MINUTES);
  if (slot.getTime() < now + leadMinutes * 60 * 1000) return null;

  // Today or tomorrow (Taipei calendar).
  const dayNumber = (ms: number) => Math.floor((ms + TAIPEI_OFFSET_MS) / DAY_MS);
  const dayDiff = dayNumber(slot.getTime()) - dayNumber(now);
  if (dayDiff < 0 || dayDiff > 1) return null;

  return slot;
}
