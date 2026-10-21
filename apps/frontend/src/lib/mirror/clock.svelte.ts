// Times are drawn in UTC on the server and switch to the visitor's time zone once the page is running.

export const clock = $state({ zone: 'UTC' });

export function useLocalZone(): void {
  try {
    clock.zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    clock.zone = 'UTC';
  }
}

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(zone: string, key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${zone}|${key}`;
  let f = cache.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...options });
    cache.set(id, f);
  }
  return f;
}

const HM = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
const HMS = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' } as const;
const DAY = { weekday: 'short', day: 'numeric', month: 'short' } as const;
const DAY_YEAR = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } as const;
const DATE = { day: 'numeric', month: 'short', year: 'numeric' } as const;
const YMD = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;

const ymd = (d: Date) => fmt(clock.zone, 'ymd', YMD).format(d);
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);

export const formatTime = (iso: string) => fmt(clock.zone, 'hm', HM).format(new Date(iso));
export const formatClock = (d: Date) => fmt(clock.zone, 'hms', HMS).format(d);
export const formatDate = (iso: string) => fmt(clock.zone, 'date', DATE).format(new Date(iso));
export const formatFull = (iso: string) => `${fmt(clock.zone, 'day-year', DAY_YEAR).format(new Date(iso))}, ${formatTime(iso)}`;

/** "Today", "Yesterday" or "Mon 19 Oct", with the year when it isn't this one. */
export function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.getFullYear() === now.getFullYear() ? fmt(clock.zone, 'day', DAY).format(d) : fmt(clock.zone, 'day-year', DAY_YEAR).format(d);
}

/** The day a message belongs to, for telling when the day changes. */
export const dayKey = (iso: string) => ymd(new Date(iso));

/** "14:02" today, "Yesterday 18:04", or "12 Oct". */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return formatTime(iso);
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return `Yesterday ${formatTime(iso)}`;
  return fmt(clock.zone, 'dm', { day: 'numeric', month: 'short' }).format(d);
}
