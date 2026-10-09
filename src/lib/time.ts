// Все даты показываются в часовом поясе студии, а не устройства.

const cache = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  const k = tz + JSON.stringify(opts)
  let f = cache.get(k)
  if (!f) { f = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, ...opts }); cache.set(k, f) }
  return f
}

function parts(d: Date, tz: string) {
  const p = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value)
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') }
}

/** YYYY-MM-DD в поясе студии. */
export function dayKey(d: Date, tz: string) {
  const p = parts(d, tz)
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

export function addDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/** ISO-день недели 1..7 для YYYY-MM-DD. */
export function isoWeekday(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return w === 0 ? 7 : w
}

/** Местные дата и время студии → момент времени (UTC ISO). */
export function zonedToUtc(day: string, time: string, tz: string) {
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  let ts = guess
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(ts), tz)
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s)
    ts = guess - (asUtc - ts)
  }
  return new Date(ts).toISOString()
}

export const timeLabel = (iso: string, tz: string) => fmt(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

export function dayLabel(day: string, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const [y, m, d] = day.split('-').map(Number)
  return fmt(tz, opts).format(new Date(Date.UTC(y, m - 1, d, 12)))
}

export function relativeDay(day: string, tz: string) {
  const today = dayKey(new Date(), tz)
  if (day === today) return 'Сегодня'
  if (day === addDays(today, 1)) return 'Завтра'
  return dayLabel(day, tz, { weekday: 'long' })
}

export function longDateTime(iso: string, tz: string) {
  const day = dayKey(new Date(iso), tz)
  return `${dayLabel(day, tz, { weekday: 'long', day: 'numeric', month: 'long' })}, ${timeLabel(iso, tz)}`
}

export function duration(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m} мин`
  if (!m) return `${h} ч`
  return `${h} ч ${m} мин`
}

export const money = (n: number) => new Intl.NumberFormat('ru-RU').format(n) + ' ₽'
export const priceLabel = (price: number, from: boolean) => (from ? 'от ' : '') + money(price)

export const hhmm = (t: string) => t.slice(0, 5)
