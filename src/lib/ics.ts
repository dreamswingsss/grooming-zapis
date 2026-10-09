// Файл календаря (.ics) — дополнительный канал напоминания. Генерируется на устройстве,
// пользователь сам добавляет событие в календарь.

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')

export function downloadIcs(o: { uid: string; title: string; start: string; end: string; location?: string; description?: string; url?: string }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//zapis//booking//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${o.uid}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(o.start)}`,
    `DTEND:${stamp(o.end)}`,
    `SUMMARY:${esc(o.title)}`,
    o.location ? `LOCATION:${esc(o.location)}` : '',
    o.description ? `DESCRIPTION:${esc(o.description)}` : '',
    o.url ? `URL:${o.url}` : '',
    'BEGIN:VALARM',
    'TRIGGER:-PT3H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(o.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'zapis.ics'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}

/** +7 (XXX) XXX-XX-XX по мере ввода. */
export function formatPhone(raw: string) {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('8')) d = '7' + d.slice(1)
  if (d && !d.startsWith('7')) d = '7' + d
  d = d.slice(0, 11)
  const p = d.slice(1)
  let out = '+7'
  if (p.length) out += ' (' + p.slice(0, 3)
  if (p.length >= 3) out += ')'
  if (p.length > 3) out += ' ' + p.slice(3, 6)
  if (p.length > 6) out += '-' + p.slice(6, 8)
  if (p.length > 8) out += '-' + p.slice(8, 10)
  return d ? out : ''
}
export const phoneDigits = (s: string) => s.replace(/\D/g, '')
