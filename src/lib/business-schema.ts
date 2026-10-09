import { z } from 'zod'

// Схема business.json — входа конвейера. Публичная часть (public) попадает в tenants.public_config.

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'цвет в формате #RRGGBB')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'время в формате ЧЧ:ММ')
const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, 'латиница, цифры и дефис')
const img = z.string().min(1)

export const publicConfigSchema = z.object({
  tagline: z.string().max(120),
  description: z.string().max(600).optional(),
  accent: hex,
  logoText: z.string().max(24).optional(),
  heroImage: img,
  heroAlt: z.string().max(140).default(''),
  city: z.string().max(60),
  address: z.string().max(140),
  addressNote: z.string().max(140).optional(),
  mapUrl: z.string().url().optional(),
  phone: z.string().max(40),
  whatsapp: z.string().max(40).optional(),
  telegram: z.string().max(60).optional(),
  vk: z.string().max(120).optional(),
  categories: z.array(z.object({ key, label: z.string().max(40) })).min(1),
  highlights: z.array(z.object({ title: z.string().max(60), text: z.string().max(160) })).max(6).default([]),
  gallery: z.array(z.object({ src: img, alt: z.string().max(140), caption: z.string().max(80).optional() })).max(16).default([]),
  faq: z.array(z.object({ q: z.string().max(140), a: z.string().max(600) })).max(12).default([]),
  rating: z.object({ value: z.number().min(0).max(5), count: z.number().int().min(0), source: z.string().max(40), url: z.string().url().optional() }).optional(),
  photoCredit: z.string().max(120).optional(),
})
export type PublicConfig = z.infer<typeof publicConfigSchema>

export const businessSchema = z.object({
  slug: key,
  name: z.string().min(1).max(60),
  timezone: z.string().default('Asia/Yekaterinburg'),
  currency: z.literal('RUB').default('RUB'),
  booking: z.object({
    slotStepMin: z.number().int().min(5).max(240).default(30),
    minLeadMin: z.number().int().min(0).max(10080).default(60),
    horizonDays: z.number().int().min(1).max(180).default(30),
    finishWithinHours: z.boolean().default(true),
  }).default({ slotStepMin: 30, minLeadMin: 60, horizonDays: 30, finishWithinHours: true }),
  hours: z.array(z.object({
    days: z.array(z.number().int().min(1).max(7)).min(1),
    opens: time,
    closes: time,
  })).min(1),
  resources: z.array(z.object({
    key,
    name: z.string().max(60),
    roleTitle: z.string().max(60).optional(),
    bio: z.string().max(300).optional(),
    photo: img.optional(),
  })).min(1),
  services: z.array(z.object({
    key,
    category: key,
    name: z.string().max(80),
    description: z.string().max(400).optional(),
    photo: img.optional(),
    bufferMin: z.number().int().min(0).max(240).default(0),
    resources: z.array(key).optional(),
    variants: z.array(z.object({
      key,
      label: z.string().max(40),
      hint: z.string().max(60).optional(),
      price: z.number().int().min(0),
      priceIsFrom: z.boolean().default(false),
      durationMin: z.number().int().min(5).max(4320),
    })).min(1),
  })).min(1),
  public: publicConfigSchema,
})
export type BusinessConfig = z.infer<typeof businessSchema>

/** Проверки, которые не выражаются схемой: ссылки на ключи, пересечения часов, уникальность. */
export function crossValidate(b: BusinessConfig): string[] {
  const errors: string[] = []
  const resKeys = new Set(b.resources.map((r) => r.key))
  const catKeys = new Set(b.public.categories.map((c) => c.key))
  const dup = (arr: string[]) => arr.filter((x, i) => arr.indexOf(x) !== i)
  for (const d of dup(b.resources.map((r) => r.key))) errors.push(`мастер «${d}» описан дважды`)
  for (const d of dup(b.services.map((s) => s.key))) errors.push(`услуга «${d}» описана дважды`)
  for (const s of b.services) {
    if (!catKeys.has(s.category)) errors.push(`услуга «${s.key}»: нет категории «${s.category}» в public.categories`)
    for (const r of s.resources ?? []) if (!resKeys.has(r)) errors.push(`услуга «${s.key}»: нет мастера «${r}»`)
    for (const d of dup(s.variants.map((v) => v.key))) errors.push(`услуга «${s.key}»: вариант «${d}» описан дважды`)
  }
  for (const h of b.hours) if (h.closes <= h.opens) errors.push(`часы ${h.opens}–${h.closes}: закрытие раньше открытия`)
  const byDay = new Map<number, { o: string; c: string }[]>()
  for (const h of b.hours) for (const d of h.days) {
    const list = byDay.get(d) ?? []
    for (const x of list) if (h.opens < x.c && x.o < h.closes) errors.push(`день ${d}: интервалы часов пересекаются`)
    list.push({ o: h.opens, c: h.closes }); byDay.set(d, list)
  }
  try { new Intl.DateTimeFormat('ru', { timeZone: b.timezone }) } catch { errors.push(`неизвестный часовой пояс ${b.timezone}`) }
  return errors
}
