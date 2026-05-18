import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth-session";
import { isValidIanaTimezone, updateUserTimezoneIfValid } from "@/server/timezone";

export const dynamic = "force-dynamic";

// Browser TimezoneReporter PATCHes this on dashboard mount. Returns 400
// on invalid input so a future caller can detect the error; CLI ingest
// endpoints take a softer approach (silently drop bad values) because
// failing the whole sync over a tz string would be disproportionate.
export async function PATCH(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null);
  if (!isValidIanaTimezone(body?.timezone)) {
    return NextResponse.json({ error: "invalid_timezone" }, { status: 400 });
  }
  await updateUserTimezoneIfValid(session.user.id, body.timezone);
  return NextResponse.json({ ok: true, timezone: body.timezone });
}
