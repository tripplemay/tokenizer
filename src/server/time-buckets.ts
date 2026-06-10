// Time-bucketing for the model detail page's custom from/to range picker.
//
// The picker hands us wall-clock strings in the user's timezone (the native
// <input type="datetime-local"> value, e.g. "2026-06-10T08:00"). The dashboard
// stores everything in UTC, so we convert wall-clock <-> UTC here, pick a bucket
// granularity from the span, and pre-generate the bucket keys so the daily/hourly
// aggregators can zero-fill gaps (a chart that skips empty hours is misleading).
//
// Granularity is derived from the span rather than chosen by the user, which
// keeps the bucket count bounded:
//   span <= 48h  -> hourly  (<= 48 buckets)
//   span <= 92d  -> daily   (<= 92 buckets)
//   else         -> weekly
// Keys are formatted to match the Postgres `to_char(date_trunc(...))` output the
// SQL side produces, so JS-generated keys and DB rows line up exactly.

export type Granularity = "hour" | "day" | "week";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_BUCKETS = 10_000; // runaway-loop backstop; real spans stay far below

export function granularityForSpan(fromMs: number, toMs: number): Granularity {
  const span = Math.max(0, toMs - fromMs);
  if (span <= 48 * HOUR_MS) return "hour";
  if (span <= 92 * DAY_MS) return "day";
  return "week";
}

// Postgres date_trunc() unit + to_char() format for a granularity. The SQL query
// uses these so its bucket keys match bucketKeys() below byte-for-byte.
export function sqlBucket(granularity: Granularity): { unit: string; format: string } {
  switch (granularity) {
    case "hour":
      return { unit: "hour", format: "YYYY-MM-DD\"T\"HH24:00" };
    case "week":
      return { unit: "week", format: "YYYY-MM-DD" };
    case "day":
    default:
      return { unit: "day", format: "YYYY-MM-DD" };
  }
}

// Offset (ms) such that `instant.getTime() + offset` is a "fake-UTC" Date whose
// UTC fields equal the wall-clock time in `tz` at that instant. Computed via the
// Intl formatter so it respects the zone's DST rules.
function tzOffsetMs(tz: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const f: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") f[part.type] = Number(part.value);
  }
  // en-US with hour12:false can render midnight as hour "24"; normalize to 0.
  const hour = f.hour === 24 ? 0 : f.hour;
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, hour, f.minute, f.second);
  return asUtc - instant.getTime();
}

// Interpret a wall-clock string in `tz` and return the corresponding UTC instant.
// Accepts "YYYY-MM-DDTHH:MM" (datetime-local) or a longer ISO-ish form.
export function wallClockToUtc(wallClock: string, tz: string): Date {
  const trimmed = wallClock.trim();
  const normalized = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
  const guess = new Date(`${normalized}Z`); // first read the wall clock as if it were UTC
  if (Number.isNaN(guess.getTime())) return new Date(NaN);
  // Two-pass: the offset at `guess` and at the true instant can differ across a
  // DST boundary, so re-probe with the first result before settling. One
  // correction step is enough for any real-world (sub-day) offset.
  const first = new Date(guess.getTime() - tzOffsetMs(tz, guess));
  return new Date(guess.getTime() - tzOffsetMs(tz, first));
}

// Format a UTC instant as a "YYYY-MM-DDTHH:MM" wall-clock string in `tz` — used to
// seed the picker's default value.
export function utcToWallClock(instant: Date, tz: string): string {
  const fake = new Date(instant.getTime() + tzOffsetMs(tz, instant));
  return fake.toISOString().slice(0, 16);
}

function truncateLocal(fake: Date, granularity: Granularity): Date {
  const d = new Date(fake.getTime());
  d.setUTCMinutes(0, 0, 0);
  if (granularity === "hour") return d;
  d.setUTCHours(0, 0, 0, 0);
  if (granularity === "day") return d;
  // Week: back up to Monday (Postgres date_trunc('week') is ISO, Monday-start).
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d;
}

function stepLocal(fake: Date, granularity: Granularity): void {
  if (granularity === "hour") fake.setUTCHours(fake.getUTCHours() + 1);
  else if (granularity === "day") fake.setUTCDate(fake.getUTCDate() + 1);
  else fake.setUTCDate(fake.getUTCDate() + 7);
}

function formatKey(fake: Date, granularity: Granularity): string {
  const iso = fake.toISOString();
  return granularity === "hour" ? `${iso.slice(0, 13)}:00` : iso.slice(0, 10);
}

// Ascending list of bucket keys covering [fromMs, toMs] in `tz`, matching the
// SQL bucket format. Zero-fill consumers map DB rows onto this list so empty
// buckets render as gaps rather than collapsing the axis.
export function bucketKeys(fromMs: number, toMs: number, granularity: Granularity, tz: string): string[] {
  if (toMs < fromMs) return [];
  const startFake = new Date(fromMs + tzOffsetMs(tz, new Date(fromMs)));
  const endFake = new Date(toMs + tzOffsetMs(tz, new Date(toMs)));
  const cursor = truncateLocal(startFake, granularity);
  const keys: string[] = [];
  while (cursor.getTime() <= endFake.getTime() && keys.length < MAX_BUCKETS) {
    keys.push(formatKey(cursor, granularity));
    stepLocal(cursor, granularity);
  }
  return keys;
}
