import fs from 'node:fs'
import path from 'node:path'
import { businessSchema, crossValidate, type BusinessConfig } from '../src/lib/business-schema'

export const root = path.resolve(import.meta.dirname, '..')
export const tenantsDir = path.join(root, 'tenants')

export function listTenants(): string[] {
  if (!fs.existsSync(tenantsDir)) return []
  return fs.readdirSync(tenantsDir).filter((d) => fs.existsSync(path.join(tenantsDir, d, 'business.json'))).sort()
}

export function tenantDir(slug: string) {
  return path.join(tenantsDir, slug)
}

export type Loaded = { config: BusinessConfig; errors: string[] }

export function loadTenant(slug: string): Loaded {
  const file = path.join(tenantDir(slug), 'business.json')
  if (!fs.existsSync(file)) return { config: null as never, errors: [`нет файла ${path.relative(root, file)}`] }
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return { config: null as never, errors: [`business.json не читается как JSON: ${(e as Error).message}`] }
  }
  const parsed = businessSchema.safeParse(raw)
  if (!parsed.success) {
    return { config: null as never, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`) }
  }
  const config = parsed.data
  const errors = crossValidate(config)
  if (config.slug !== slug) errors.push(`slug в файле («${config.slug}») не совпадает с папкой («${slug}»)`)
  // Локальные изображения должны лежать в tenants/{slug}/media/
  for (const src of localImages(config)) {
    if (!fs.existsSync(path.join(tenantDir(slug), 'media', src))) errors.push(`нет файла изображения tenants/${slug}/media/${src}`)
  }
  return { config, errors }
}

export function localImages(c: BusinessConfig): string[] {
  const all = [
    c.public.heroImage,
    ...c.public.gallery.map((g) => g.src),
    ...c.services.map((s) => s.photo),
    ...c.resources.map((r) => r.photo),
  ].filter((x): x is string => Boolean(x))
  return [...new Set(all.filter((s) => !/^(https?:)?\/\//.test(s) && !s.startsWith('/')))]
}

/** JSON для admin_publish_tenant: публичная часть отдельно, без локальных путей. */
export function publishPayload(c: BusinessConfig) {
  return {
    slug: c.slug,
    name: c.name,
    timezone: c.timezone,
    currency: c.currency,
    booking: c.booking,
    hours: c.hours,
    resources: c.resources,
    services: c.services,
    public: c.public,
  }
}

export function args() {
  const a = process.argv.slice(2)
  const flags = new Map<string, string | true>()
  const pos: string[] = []
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2)
      const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true
      flags.set(k, v)
    } else pos.push(a[i])
  }
  return { pos, flags }
}

export function env(name: string, required = true) {
  const v = process.env[name]
  if (!v && required) {
    console.error(`✗ Не задана переменная окружения ${name} (см. .env.example)`)
    process.exit(1)
  }
  return v ?? ''
}

export const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`

export function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
