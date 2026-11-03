// Time helpers. Every "day" is a calendar day in the ad account time zone, never a UTC day.
export const TZ = 'America/New_York';

const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  return fmtCache.get(tz);
}

export function localParts(ms, tz = TZ) {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}`, y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

export const localDate = (ms, tz = TZ) => localParts(ms, tz).date;

// Offset of the zone at instant ms, in minutes (negative west of UTC).
export function offsetMinutes(ms, tz = TZ) {
  const p = localParts(ms, tz);
  return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60000;
}

// UTC instant of a local wall-clock time (first occurrence when the hour repeats).
export function localToUtc(dateStr, hh = 0, mm = 0, tz = TZ) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ms = guess - offsetMinutes(guess, tz) * 60000;
  const ms2 = guess - offsetMinutes(ms, tz) * 60000;
  return Math.min(ms, ms2);
}

export function nextDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = nextDate(d)) out.push(d);
  return out;
}

export const hoursInLocalDay = (dateStr, tz = TZ) => (localToUtc(nextDate(dateStr), 0, 0, tz) - localToUtc(dateStr, 0, 0, tz)) / 3600000;

// Sum UTC-stamped rows into local calendar days. Returns { date: { total, rows } }.
export function bucketByLocalDate(rows, key = 'spend_cents', tz = TZ) {
  const out = {};
  for (const r of rows) {
    const d = localDate(Date.parse(r.ts_utc), tz);
    out[d] ??= { total: 0, rows: 0 };
    out[d].total += r[key];
    out[d].rows += 1;
  }
  return out;
}

export function clockLabel(ms, tz = TZ) {
  const p = localParts(ms, tz);
  return `${p.time.slice(0, 5)} ET`;
}
export function clockLabelSec(ms, tz = TZ) {
  return `${localParts(ms, tz).time} ET`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayLabel(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
