// ============================================================
// verifyLineToken — verifies a LIFF ID token against LINE's own
// verify endpoint and returns the verified LINE user id (`sub`).
//
// This is a plain in-process helper, NOT its own Edge Function.
// Stored Value functions (spend, balance read, etc.) will import and
// call this directly to check who's making the request. It has no
// caller yet — it was exercised against real LINE ID tokens via a
// temporary debug-verify-line Edge Function, which has since been
// deleted (deployment and repo both) now that verification is done.
//
// Endpoint: POST https://api.line.me/oauth2/v2.1/verify
// Docs: https://developers.line.biz/en/reference/line-login/#verify-id-token
// No channel secret needed — id_token + client_id (the LINE Login
// channel ID, NOT the LIFF_ID from app.js) is enough.
// ============================================================

const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

// The LINE Login channel ID the LIFF app (LIFF_ID in app.js) lives
// under. Not sensitive — same trust level as LIFF_ID, which is
// already committed in plain sight — so it's hardcoded here rather
// than plumbed through as an env var/secret.
const LINE_LOGIN_CHANNEL_ID = "2011450491";

/** Distinct failure reasons — callers should branch on `.code`, not parse `.message`. */
export type LineTokenErrorCode =
  | "missing_token" // no id_token was given to us at all
  | "config" // LINE_LOGIN_CHANNEL_ID isn't set on this function
  | "expired" // token's exp has passed
  | "wrong_audience" // token was issued for a different channel
  | "invalid" // bad signature / malformed / any other LINE-side rejection
  | "network" // couldn't reach api.line.me at all
  | "unknown"; // LINE responded, but not in a shape we recognize

export class LineTokenVerificationError extends Error {
  code: LineTokenErrorCode;
  constructor(code: LineTokenErrorCode, message: string) {
    super(message);
    this.name = "LineTokenVerificationError";
    this.code = code;
  }
}

interface LineVerifyOkResponse {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nonce?: string;
  amr?: string[];
  name?: string;
  picture?: string;
  email?: string;
}

interface LineVerifyErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Verifies a LINE ID token and returns the verified LINE user id (`sub`)
 * on success. Throws LineTokenVerificationError on any failure — expired
 * token, bad/tampered signature, wrong audience, and LINE being
 * unreachable are all distinguished via `err.code`.
 */
export async function verifyLineToken(idToken: string): Promise<string> {
  if (!idToken) {
    throw new LineTokenVerificationError("missing_token", "No id_token provided");
  }
  if (!LINE_LOGIN_CHANNEL_ID) {
    throw new LineTokenVerificationError(
      "config",
      "LINE_LOGIN_CHANNEL_ID is not set for this Edge Function"
    );
  }

  let response: Response;
  try {
    response = await fetch(LINE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id_token: idToken,
        client_id: LINE_LOGIN_CHANNEL_ID,
      }),
    });
  } catch (networkErr) {
    throw new LineTokenVerificationError(
      "network",
      `Could not reach LINE's verify endpoint: ${(networkErr as Error).message}`
    );
  }

  if (!response.ok) {
    let body: LineVerifyErrorResponse | null = null;
    try {
      body = await response.json();
    } catch {
      // LINE didn't send JSON back (e.g. an upstream 5xx HTML page) —
      // fall through with body left null, handled below.
    }

    const description = body?.error_description ?? "";
    const lower = description.toLowerCase();

    if (lower.includes("expired")) {
      throw new LineTokenVerificationError("expired", `LINE ID token expired: ${description}`);
    }
    if (lower.includes("aud") || lower.includes("audience") || lower.includes("client")) {
      throw new LineTokenVerificationError(
        "wrong_audience",
        `LINE ID token was not issued for this channel: ${description}`
      );
    }
    if (body) {
      throw new LineTokenVerificationError(
        "invalid",
        `LINE rejected the ID token (${body.error}): ${description || "no description"}`
      );
    }
    throw new LineTokenVerificationError(
      "unknown",
      `LINE verify endpoint returned HTTP ${response.status} with no parseable body`
    );
  }

  let ok: LineVerifyOkResponse;
  try {
    ok = await response.json();
  } catch {
    throw new LineTokenVerificationError(
      "unknown",
      "LINE verify endpoint returned 200 but the body wasn't valid JSON"
    );
  }

  if (!ok.sub) {
    throw new LineTokenVerificationError(
      "unknown",
      "LINE verify endpoint returned 200 but no `sub` claim was present"
    );
  }

  return ok.sub;
}
