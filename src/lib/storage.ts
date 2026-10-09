// Браузерное хранилище — только для удобства (свои записи клиента, черновик контактов).
// Может быть недоступно (приватный режим) — всё обёрнуто в try/catch.

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* недоступно */ }
}

export type SavedBooking = { token: string; startsAt: string; service: string }

export function savedBookings(slug: string): SavedBooking[] {
  return read<SavedBooking[]>(`zapis:${slug}:bookings`, [])
}
export function rememberBooking(slug: string, b: SavedBooking) {
  const list = savedBookings(slug).filter((x) => x.token !== b.token)
  write(`zapis:${slug}:bookings`, [b, ...list].slice(0, 20))
}
export function forgetBooking(slug: string, token: string) {
  write(`zapis:${slug}:bookings`, savedBookings(slug).filter((x) => x.token !== token))
}

export type ContactDraft = { name: string; phone: string; petName: string; petBreed: string }
export const contactDraft = (slug: string) => read<ContactDraft>(`zapis:${slug}:contact`, { name: '', phone: '', petName: '', petBreed: '' })
export const saveContactDraft = (slug: string, d: ContactDraft) => write(`zapis:${slug}:contact`, d)

/** Ключ идемпотентности переживает повторную отправку и перезагрузку во время запроса. */
export function pendingKey(slug: string, fingerprint: string) {
  const k = `zapis:${slug}:pending:${fingerprint}`
  try {
    const existing = sessionStorage.getItem(k)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    sessionStorage.setItem(k, fresh)
    return fresh
  } catch {
    return crypto.randomUUID()
  }
}
export function clearPendingKey(slug: string, fingerprint: string) {
  try { sessionStorage.removeItem(`zapis:${slug}:pending:${fingerprint}`) } catch { /* ignore */ }
}
