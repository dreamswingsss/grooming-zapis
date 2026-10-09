// Проверка опубликованной студии глазами анонимного клиента:
//   npm run tenant:verify -- <slug> [--site https://my.vercel.app]
// Нужны VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (публичный ключ).
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { args, env, fail, loadTenant, root } from './lib'

const { pos, flags } = args()
const slug = pos[0] ?? fail('укажите slug')
const { config, errors } = loadTenant(slug)
if (errors.length) fail(`конфиг невалиден: ${errors.join('; ')}`)

const sb = createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'), { auth: { persistSession: false } })
const problems: string[] = []
const ok = (m: string) => console.log(`✓ ${m}`)

const { data: t, error } = await sb.from('tenants').select('id, slug, name, status').eq('slug', slug).maybeSingle()
if (error || !t) fail(`студия не видна анонимно: ${error?.message ?? 'не найдена'}`)
ok(`студия видна: «${t.name}», статус ${t.status}`)

const svc = await sb.from('services').select('key, is_active').eq('tenant_id', t.id)
const activeKeys = new Set((svc.data ?? []).filter((s) => s.is_active).map((s) => s.key))
for (const s of config.services) if (!activeKeys.has(s.key)) problems.push(`услуга ${s.key} не опубликована`)
if (activeKeys.size === config.services.length) ok(`услуг опубликовано: ${activeKeys.size}`)

// Анонимный клиент не должен видеть записи и платежи.
const leak = await sb.from('bookings').select('id').limit(1)
if (!leak.error && (leak.data?.length ?? 0) > 0) problems.push('анонимный клиент видит таблицу bookings!')
else ok('записи скрыты от анонимных пользователей')
const leakPay = await sb.from('payments').select('id').limit(1)
if (!leakPay.error && (leakPay.data?.length ?? 0) > 0) problems.push('анонимный клиент видит платежи!')

const v = await sb.from('service_variants').select('id').eq('tenant_id', t.id).eq('is_active', true).limit(1).single()
if (v.data) {
  const today = new Date().toISOString().slice(0, 10)
  const to = new Date(Date.now() + 13 * 86400_000).toISOString().slice(0, 10)
  const days = await sb.rpc('get_available_days', { p_slug: slug, p_variant_id: v.data.id, p_from: today, p_to: to })
  if (days.error) problems.push(`get_available_days: ${days.error.message}`)
  else if (!days.data.length) problems.push('нет свободных дней на 2 недели — проверьте часы работы')
  else ok(`свободные дни есть: ${days.data.length} из 14`)
}

const local = path.join(root, 'dist', 's', slug)
for (const f of ['index.html', 'manifest.webmanifest', 'owner/index.html', 'owner/manifest.webmanifest', 'sw.js', 'icons/icon-192.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png']) {
  if (!fs.existsSync(path.join(local, f))) problems.push(`нет dist/s/${slug}/${f} — запустите npm run build`)
}
if (!problems.some((p) => p.startsWith('нет dist'))) ok('статические файлы студии собраны')

const site = typeof flags.get('site') === 'string' ? String(flags.get('site')).replace(/\/$/, '') : ''
if (site) {
  for (const p of [`/s/${slug}/`, `/s/${slug}/services`, `/s/${slug}/owner/`, `/s/${slug}/manifest.webmanifest`, `/s/${slug}/sw.js`]) {
    const r = await fetch(site + p)
    if (!r.ok) problems.push(`${p}: HTTP ${r.status}`)
    else if (p.endsWith('/') || p.endsWith('services')) {
      const html = await r.text()
      if (!html.includes(`/s/${slug}/manifest.webmanifest`) && !html.includes(`/s/${slug}/owner/manifest.webmanifest`)) problems.push(`${p}: отдаётся не оболочка этой студии`)
    }
  }
  if (!problems.some((p) => p.startsWith('/'))) ok(`сайт ${site} отдаёт оболочку студии и манифест`)
}

if (problems.length) {
  console.error('\nПроблемы:')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('\nВсё в порядке.')
