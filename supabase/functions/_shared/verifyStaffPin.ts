// ============================================================
// verifyStaffPin — compares a staff-entered PIN against the STAFF_PIN
// Edge Function secret using a constant-time comparison, so response
// timing can't be used to guess the PIN one character at a time.
//
// Plain in-process helper, NOT its own Edge Function — future Stored
// Value functions that need staff authorization (e.g. manual top-up)
// will import and call this directly. It has no caller yet — it was
// exercised against the real STAFF_PIN secret via a temporary
// debug-verify-staff-pin Edge Function, which has since been deleted
// (deployment and repo both) now that verification is done.
//
// The PIN itself is never in code — set it yourself with:
//   supabase secrets set STAFF_PIN=xxxx
// ============================================================

/**
 * Returns true if `pin` matches the STAFF_PIN secret, false otherwise —
 * including when STAFF_PIN isn't set, or `pin` is empty. Never throws.
 */
export function verifyStaffPin(pin: string): boolean {
  const expected = Deno.env.get("STAFF_PIN") ?? "";
  if (!expected || !pin) return false;
  return timingSafeEqual(pin, expected);
}

// Constant-time string comparison. Deliberately avoids `===`/`==`,
// which short-circuits on the first differing character and can leak
// how many leading characters were guessed correctly via response
// timing. A length mismatch is folded into `diff` up front rather
// than returned early, so a wrong-length guess takes the same code
// path (and, at this length scale, indistinguishable time) as any
// other wrong guess.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length, 1);

  const aPadded = new Uint8Array(maxLen);
  const bPadded = new Uint8Array(maxLen);
  aPadded.set(aBytes);
  bPadded.set(bBytes);

  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= aPadded[i] ^ bPadded[i];
  }
  return diff === 0;
}
