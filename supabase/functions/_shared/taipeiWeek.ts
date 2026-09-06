// ============================================================
// taipeiWeek — calendar-date helpers for the Weekday Stamp Card,
// entirely in Asia/Taipei local time (fixed UTC+8, no DST — Taiwan
// hasn't observed DST since 1979, so there are no seasonal edge cases
// to handle here, unlike a real DST timezone).
//
// The trick used throughout: shift a UTC instant by the fixed +8h
// offset, then read its UTC calendar fields (getUTCFullYear() etc.) —
// those shifted UTC fields ARE the correct Taipei-local calendar
// fields, without needing a timezone database.
// ============================================================

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface TaipeiToday extends CalendarDate {
  dayOfWeek: number; // 0=Sun .. 6=Sat, per the Taipei calendar
}

// Current Taipei-local calendar date + day-of-week.
export function taipeiNow(): TaipeiToday {
  const shifted = new Date(Date.now() + TAIPEI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

// [startUtc, endUtc) ISO timestamps covering one Taipei calendar day —
// for querying a timestamptz column (orders.created_at) by Taipei day
// rather than UTC day.
export function taipeiDayRangeUtc(date: CalendarDate): { startUtc: string; endUtc: string } {
  const startMs = Date.UTC(date.year, date.month - 1, date.day) - TAIPEI_OFFSET_MS;
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

// Monday (Taipei calendar) of the week containing `date`.
export function taipeiWeekMonday(date: TaipeiToday): CalendarDate {
  const asUtcMidnight = Date.UTC(date.year, date.month - 1, date.day);
  const mondayOffsetDays = (date.dayOfWeek + 6) % 7; // Mon=0 .. Sun=6
  const monday = new Date(asUtcMidnight - mondayOffsetDays * 24 * 60 * 60 * 1000);
  return { year: monday.getUTCFullYear(), month: monday.getUTCMonth() + 1, day: monday.getUTCDate() };
}

// Adds `days` Taipei calendar days to `date`.
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const ms = Date.UTC(date.year, date.month - 1, date.day) + days * 24 * 60 * 60 * 1000;
  const shifted = new Date(ms);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

// "YYYY-MM-DD" — matches Postgres `date` column formatting, used for
// stamp_redemptions.week_start.
export function isoDateString(date: CalendarDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${date.year}-${mm}-${dd}`;
}
