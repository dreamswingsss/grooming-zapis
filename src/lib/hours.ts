import type { Catalog } from './api'
import { addDays, dayKey, hhmm, isoWeekday, zonedToUtc } from './time'

export type DayHours = { day: string; ranges: { opens: string; closes: string }[]; exception: boolean }

export function hoursFor(c: Catalog, day: string): DayHours {
  const ex = c.exceptions.find((e) => e.day === day)
  if (ex) {
    return { day, exception: true, ranges: ex.is_closed || !ex.opens_at || !ex.closes_at ? [] : [{ opens: hhmm(ex.opens_at), closes: hhmm(ex.closes_at) }] }
  }
  const wd = isoWeekday(day)
  return {
    day,
    exception: false,
    ranges: c.hours.filter((h) => h.weekday === wd).map((h) => ({ opens: hhmm(h.opens_at), closes: hhmm(h.closes_at) })),
  }
}

/** «Открыто до 21:00» / «Откроется завтра в 10:00». */
export function openStatus(c: Catalog, now = new Date()) {
  const tz = c.tenant.timezone
  const today = dayKey(now, tz)
  const t = hoursFor(c, today)
  for (const r of t.ranges) {
    const o = new Date(zonedToUtc(today, r.opens, tz))
    const cl = new Date(zonedToUtc(today, r.closes, tz))
    if (now >= o && now < cl) return { open: true, text: `Открыто до ${r.closes}` }
    if (now < o) return { open: false, text: `Откроется сегодня в ${r.opens}` }
  }
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, i)
    const h = hoursFor(c, d)
    if (h.ranges.length) return { open: false, text: `Откроется ${i === 1 ? 'завтра' : 'в ' + new Intl.DateTimeFormat('ru-RU', { weekday: 'long', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z')).toLowerCase()} в ${h.ranges[0].opens}` }
  }
  return { open: false, text: 'Сейчас закрыто' }
}

const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/** Сжатое расписание по дням недели: «Пн–Пт 10:00–21:00». */
export function weeklySummary(c: Catalog) {
  const rows = names.map((n, i) => ({
    n,
    v: c.hours.filter((h) => h.weekday === i + 1).map((h) => `${hhmm(h.opens_at)}–${hhmm(h.closes_at)}`).join(', ') || 'выходной',
  }))
  const out: { days: string; value: string }[] = []
  for (let i = 0; i < rows.length; ) {
    let j = i
    while (j + 1 < rows.length && rows[j + 1].v === rows[i].v) j++
    out.push({ days: i === j ? rows[i].n : `${rows[i].n}–${rows[j].n}`, value: rows[i].v })
    i = j + 1
  }
  return out
}
