const numbers = new Intl.NumberFormat('en');
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' });
const dates = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });

const plurals = new Intl.PluralRules('en');

export const formatNumber = (n: number) => numbers.format(n);

/** Whole pluralized strings: `plural(2, { one: '# strike', other: '# strikes' })` → `2 strikes`. */
export const plural = (n: number, forms: { one: string; other: string }) =>
  (plurals.select(n) === 'one' ? forms.one : forms.other).replace('#', formatNumber(n));
export const formatDate = (at: number) => dates.format(at);

/** Probation is level 0; every other level is just its number. */
export const levelName = (level: number) => (level === 0 ? 'Probation' : `Level ${level}`);

/** `K7QM2XHD` → `K7QM-2XHD`, the way agents show their adoption code. */
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export function timeAgo(at: number, now = Date.now()) {
  const seconds = Math.round((at - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function countdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
