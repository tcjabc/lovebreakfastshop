// ============================================================
// computeStampProgress — the single place "is this member's Weekday
// Stamp Card unlocked, and have they already redeemed this week" gets
// computed. Shared by get-stamp-progress (reports it) and
// redeem-stamp-drink (re-derives it server-side before honoring a
// redemption, never trusting the client's own copy) — deliberately one
// function, not two similar-looking implementations that could drift
// apart on exactly the logic that decides whether a free drink gets
// handed out.
// ============================================================

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { addDays, isoDateString, taipeiDayRangeUtc, taipeiNow, taipeiWeekMonday } from "./taipeiWeek.ts";

export const STAMP_QUALIFYING_SPEND = 85;

export interface StampProgress {
  days: [boolean, boolean, boolean, boolean]; // Mon, Tue, Wed, Thu
  unlocked: boolean;
  redeemed: boolean;
  weekStart: string; // "YYYY-MM-DD", the Monday of this week (Taipei)
  todayDayOfWeek: number; // 0=Sun .. 6=Sat, Taipei — Friday is 5
}

export async function computeStampProgress(
  supabase: SupabaseClient,
  userId: string
): Promise<StampProgress> {
  const today = taipeiNow();
  const monday = taipeiWeekMonday(today);
  const weekStart = isoDateString(monday);

  const days: boolean[] = [];
  for (let i = 0; i < 4; i++) {
    // Mon..Thu
    const day = addDays(monday, i);
    const { startUtc, endUtc } = taipeiDayRangeUtc(day);

    const { data, error } = await supabase
      .from("orders")
      .select("total")
      .eq("user_id", userId)
      .gte("created_at", startUtc)
      .lt("created_at", endUtc);
    if (error) throw error;

    const daySpend = (data ?? []).reduce((sum: number, o: { total: number }) => sum + o.total, 0);
    days.push(daySpend >= STAMP_QUALIFYING_SPEND);
  }

  const unlocked = days.every(Boolean);

  const { data: redemption, error: redemptionError } = await supabase
    .from("stamp_redemptions")
    .select("user_id")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (redemptionError) throw redemptionError;

  return {
    days: days as [boolean, boolean, boolean, boolean],
    unlocked,
    redeemed: !!redemption,
    weekStart,
    todayDayOfWeek: today.dayOfWeek,
  };
}
