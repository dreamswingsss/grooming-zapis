import { z } from 'zod'
import { supabase } from './supabase'
import { publicConfigSchema } from './business-schema'

// ───────── Типы и парсинг ответов ─────────

const tenantRow = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['preview', 'live', 'disabled']),
  timezone: z.string(),
  currency: z.string(),
  slot_step_min: z.number(),
  min_lead_min: z.number(),
  horizon_days: z.number(),
  public_config: publicConfigSchema,
})

const resourceRow = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  role_title: z.string().nullable(),
  bio: z.string().nullable(),
  photo_url: z.string().nullable(),
  is_active: z.boolean(),
  sort: z.number(),
})

const variantRow = z.object({
  id: z.string().uuid(),
  service_id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  hint: z.string().nullable(),
  price: z.number(),
  price_is_from: z.boolean(),
  duration_min: z.number(),
  is_active: z.boolean(),
  sort: z.number(),
})

const serviceRow = z.object({
  id: z.string().uuid(),
  key: z.string(),
  category: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  photo_url: z.string().nullable(),
  buffer_min: z.number(),
  is_active: z.boolean(),
  sort: z.number(),
})

const hoursRow = z.object({ weekday: z.number(), opens_at: z.string(), closes_at: z.string() })
const exceptionRow = z.object({ day: z.string(), is_closed: z.boolean(), opens_at: z.string().nullable(), closes_at: z.string().nullable() })

export type Tenant = z.infer<typeof tenantRow>
export type Resource = z.infer<typeof resourceRow>
export type Variant = z.infer<typeof variantRow>
export type Service = z.infer<typeof serviceRow> & { variants: Variant[]; resourceIds: string[] }
export type Hours = z.infer<typeof hoursRow>
export type DayException = z.infer<typeof exceptionRow>

export type Catalog = {
  tenant: Tenant
  resources: Resource[]
  services: Service[]
  hours: Hours[]
  exceptions: DayException[]
}

export class ApiError extends Error {
  code: string
  status?: number
  constructor(code: string, message: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

const messages: Record<string, string> = {
  TENANT_NOT_FOUND: 'Студия не найдена или ещё не опубликована.',
  SERVICE_NOT_FOUND: 'Эта услуга сейчас недоступна.',
  SLOT_TAKEN: 'Это время только что заняли. Выберите другое.',
  SLOT_UNAVAILABLE: 'На это время записаться нельзя. Выберите другое.',
  RATE_LIMITED: 'Слишком много попыток. Подождите пару минут и попробуйте снова.',
  BAD_PHONE: 'Проверьте номер телефона: нужно 10–11 цифр.',
  BAD_NAME: 'Укажите имя.',
  BOOKING_NOT_FOUND: 'Запись не найдена. Возможно, ссылка неполная.',
  TOO_LATE_TO_CHANGE: 'Изменить запись можно не позднее чем за 2 часа. Позвоните в студию.',
  FORBIDDEN: 'Нет доступа к этой студии.',
  OVERLAPS_BOOKING: 'На это время уже есть запись — сначала перенесите её.',
  BOOKING_CANCELLED: 'Запись уже отменена.',
  BOOKING_NOT_ACTIVE: 'Перенести можно только подтверждённую запись.',
  RESOURCE_NOT_FOUND: 'Мастер не найден.',
  BAD_AMOUNT: 'Проверьте сумму.',
  BAD_RANGE: 'Проверьте период.',
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  const err = e as { message?: string; code?: string; status?: number }
  const code = (err?.message ?? '').split(':')[0].trim()
  if (messages[code]) return new ApiError(code, messages[code], err.status)
  if (err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError')) {
    return new ApiError('NETWORK', 'Нет соединения. Проверьте интернет и повторите.')
  }
  return new ApiError(code || 'UNKNOWN', 'Что-то пошло не так. Попробуйте ещё раз.', err.status)
}

async function rpc<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw toApiError(error)
  return schema.parse(data)
}

// ───────── Каталог студии ─────────

export async function fetchCatalog(slug: string): Promise<Catalog> {
  try {
    const { data: t, error: te } = await supabase
      .from('tenants')
      .select('id, slug, name, status, timezone, currency, slot_step_min, min_lead_min, horizon_days, public_config')
      .eq('slug', slug)
      .maybeSingle()
    if (te) throw te
    if (!t) throw new ApiError('TENANT_NOT_FOUND', messages.TENANT_NOT_FOUND, 404)
    const tenant = tenantRow.parse(t)

    const today = new Date().toISOString().slice(0, 10)
    const [res, svc, vars, links, hrs, exc] = await Promise.all([
      supabase.from('resources').select('id, key, name, role_title, bio, photo_url, is_active, sort').eq('tenant_id', tenant.id).order('sort'),
      supabase.from('services').select('id, key, category, name, description, photo_url, buffer_min, is_active, sort').eq('tenant_id', tenant.id).order('sort'),
      supabase.from('service_variants').select('id, service_id, key, label, hint, price, price_is_from, duration_min, is_active, sort').eq('tenant_id', tenant.id).order('sort'),
      supabase.from('service_resources').select('service_id, resource_id').eq('tenant_id', tenant.id),
      supabase.from('working_hours').select('weekday, opens_at, closes_at').eq('tenant_id', tenant.id).order('weekday'),
      supabase.from('schedule_exceptions').select('day, is_closed, opens_at, closes_at').eq('tenant_id', tenant.id).gte('day', today),
    ])
    for (const r of [res, svc, vars, links, hrs, exc]) if (r.error) throw r.error

    const variants = z.array(variantRow).parse(vars.data)
    const linkRows = z.array(z.object({ service_id: z.string(), resource_id: z.string() })).parse(links.data)
    const services = z.array(serviceRow).parse(svc.data).map((s) => ({
      ...s,
      variants: variants.filter((v) => v.service_id === s.id),
      resourceIds: linkRows.filter((l) => l.service_id === s.id).map((l) => l.resource_id),
    }))
    return {
      tenant,
      resources: z.array(resourceRow).parse(res.data),
      services,
      hours: z.array(hoursRow).parse(hrs.data),
      exceptions: z.array(exceptionRow).parse(exc.data),
    }
  } catch (e) {
    throw toApiError(e)
  }
}

// ───────── Клиентская запись ─────────

const slotRow = z.object({ starts_at: z.string(), resource_ids: z.array(z.string()) })
export type Slot = z.infer<typeof slotRow>

export const getSlots = (slug: string, variantId: string, day: string) =>
  rpc('get_slots', { p_slug: slug, p_variant_id: variantId, p_day: day }, z.array(slotRow))

export const getAvailableDays = (slug: string, variantId: string, from: string, to: string) =>
  rpc('get_available_days', { p_slug: slug, p_variant_id: variantId, p_from: from, p_to: to }, z.array(z.string()))

export const bookingSchema = z.object({
  id: z.string(),
  token: z.string(),
  status: z.enum(['confirmed', 'arrived', 'done', 'cancelled', 'no_show']),
  starts_at: z.string(),
  ends_at: z.string(),
  service_id: z.string(),
  variant_id: z.string(),
  service_name: z.string(),
  variant_label: z.string(),
  price: z.number(),
  price_is_from: z.boolean(),
  duration_min: z.number(),
  resource: z.object({ id: z.string(), name: z.string(), photo_url: z.string().nullable() }).nullable(),
  customer_name: z.string(),
  pet_name: z.string().nullable(),
  pet_breed: z.string().nullable(),
  comment: z.string().nullable(),
  is_demo: z.boolean(),
  tenant_slug: z.string(),
  can_change: z.boolean(),
})
export type Booking = z.infer<typeof bookingSchema>

export type NewBooking = {
  slug: string
  variantId: string
  startsAt: string
  resourceId: string | null
  name: string
  phone: string
  petName: string
  petBreed: string
  comment: string
  idempotencyKey: string
}

export const createBooking = (b: NewBooking) =>
  rpc('create_booking', {
    p_slug: b.slug,
    p_variant_id: b.variantId,
    p_starts_at: b.startsAt,
    p_customer_name: b.name,
    p_customer_phone: b.phone,
    p_idempotency_key: b.idempotencyKey,
    p_resource_id: b.resourceId,
    p_pet_name: b.petName || null,
    p_pet_breed: b.petBreed || null,
    p_comment: b.comment || null,
  }, bookingSchema)

export const getBooking = (token: string) => rpc('get_booking', { p_token: token }, bookingSchema)
export const cancelBooking = (token: string) => rpc('cancel_booking', { p_token: token }, bookingSchema)
export const rescheduleBooking = (token: string, startsAt: string, resourceId: string | null) =>
  rpc('reschedule_booking', { p_token: token, p_starts_at: startsAt, p_resource_id: resourceId }, bookingSchema)

// ───────── Кабинет владельца ─────────

const myTenant = z.object({ id: z.string(), slug: z.string(), name: z.string(), status: z.string(), timezone: z.string(), role: z.string() })
export const ownerMyTenants = () => rpc('owner_my_tenants', {}, z.array(myTenant))

export const ownerBookingSchema = z.object({
  id: z.string(),
  status: z.enum(['confirmed', 'arrived', 'done', 'cancelled', 'no_show']),
  starts_at: z.string(),
  ends_at: z.string(),
  variant_id: z.string(),
  service_name: z.string(),
  variant_label: z.string(),
  price: z.number(),
  price_is_from: z.boolean(),
  duration_min: z.number(),
  resource_id: z.string(),
  customer_name: z.string(),
  customer_phone: z.string(),
  pet_name: z.string().nullable(),
  pet_breed: z.string().nullable(),
  comment: z.string().nullable(),
  source: z.string(),
  is_demo: z.boolean(),
  created_at: z.string(),
  paid: z.number(),
})
export type OwnerBooking = z.infer<typeof ownerBookingSchema>
const blockSchema = z.object({ id: z.string(), resource_id: z.string(), starts_at: z.string(), ends_at: z.string(), note: z.string().nullable() })
export type Block = z.infer<typeof blockSchema>

export const ownerAgenda = (tenantId: string, from: string, to: string) =>
  rpc('owner_agenda', { p_tenant: tenantId, p_from: from, p_to: to }, z.object({ bookings: z.array(ownerBookingSchema), blocks: z.array(blockSchema) }))

export const ownerSetStatus = (bookingId: string, status: OwnerBooking['status']) =>
  rpc('owner_set_status', { p_booking: bookingId, p_status: status }, z.unknown())

export const ownerReschedule = (bookingId: string, startsAt: string, resourceId: string | null) =>
  rpc('owner_reschedule', { p_booking: bookingId, p_starts_at: startsAt, p_resource_id: resourceId }, z.unknown())

export const ownerAddPayment = (bookingId: string, amount: number, method: 'cash' | 'card' | 'transfer') =>
  rpc('owner_add_payment', { p_booking: bookingId, p_amount: amount, p_method: method }, z.unknown())

export const ownerBlock = (tenantId: string, resourceId: string | null, from: string, to: string, note: string) =>
  rpc('owner_block', { p_tenant: tenantId, p_resource_id: resourceId, p_from: from, p_to: to, p_note: note || null }, z.unknown())

export const ownerUnblock = (id: string) => rpc('owner_unblock', { p_occupancy: id }, z.unknown())

export const ownerSetDay = (tenantId: string, day: string, closed: boolean, opens: string | null, closes: string | null) =>
  rpc('owner_set_day', { p_tenant: tenantId, p_day: day, p_is_closed: closed, p_opens: opens, p_closes: closes }, z.unknown())

export const ownerClearDay = (tenantId: string, day: string) => rpc('owner_clear_day', { p_tenant: tenantId, p_day: day }, z.unknown())

export const ownerUpdateVariant = (variantId: string, price: number, durationMin: number, isActive: boolean) =>
  rpc('owner_update_variant', { p_variant: variantId, p_price: price, p_duration_min: durationMin, p_is_active: isActive }, z.unknown())

export const ownerCreateBooking = (a: { tenantId: string; variantId: string; resourceId: string; startsAt: string; name: string; phone: string; petName: string; petBreed: string; comment: string }) =>
  rpc('owner_create_booking', {
    p_tenant: a.tenantId, p_variant_id: a.variantId, p_resource_id: a.resourceId, p_starts_at: a.startsAt,
    p_customer_name: a.name, p_customer_phone: a.phone, p_pet_name: a.petName || null, p_pet_breed: a.petBreed || null, p_comment: a.comment || null,
  }, z.object({ id: z.string() }))

export const statsSchema = z.object({
  timezone: z.string(),
  from: z.string(),
  to: z.string(),
  bookings_total: z.number(),
  visits: z.number(),
  completed: z.number(),
  no_show: z.number(),
  cancelled: z.number(),
  paid_total: z.number(),
  completed_value: z.number(),
  expected_value: z.number(),
  by_service: z.array(z.object({ name: z.string(), cnt: z.number(), done_value: z.number() })),
  by_day: z.array(z.object({ day: z.string(), bookings: z.number() })),
})
export type Stats = z.infer<typeof statsSchema>
export const ownerStats = (tenantId: string, from: string, to: string) =>
  rpc('owner_stats', { p_tenant: tenantId, p_from: from, p_to: to }, statsSchema)
