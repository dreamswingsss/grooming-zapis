// Публикация студии в Supabase.
//   npm run tenant:publish -- <slug> [--live] [--demo 8]
//       напрямую через API (нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY)
//   npm run tenant:publish -- <slug> --sql supabase/publish-<slug>.sql [--live] [--demo 8]
//       SQL-файл для вставки в SQL Editor, если прямого доступа нет
// Повторная публикация сохраняет записи, платежи, выходные и цены прошлых записей.
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { args, env, fail, loadTenant, publishPayload, root, sqlString } from './lib'

const { pos, flags } = args()
const slug = pos[0] ?? fail('укажите slug: npm run tenant:publish -- pompon')
const { config, errors } = loadTenant(slug)
if (errors.length) fail(`конфиг ${slug} невалиден:\n   · ${errors.join('\n   · ')}`)

const status = flags.has('live') ? 'live' : flags.has('preview') ? 'preview' : null
const demo = flags.has('demo') ? Number(flags.get('demo') === true ? 8 : flags.get('demo')) : 0
if (status === 'live' && demo) fail('демо-записи только для preview')

const payload = publishPayload(config)

export function publishSql(): string {
  const json = sqlString(JSON.stringify(payload))
  const lines = [
    `-- Публикация «${config.name}» (${slug})`,
    `select public.admin_publish_tenant(${json}::jsonb, ${status ? sqlString(status) : 'null'});`,
  ]
  if (demo) lines.push(`select public.admin_seed_demo(${sqlString(slug)}, ${demo});`)
  return lines.join('\n') + '\n'
}

if (flags.has('sql')) {
  const out = typeof flags.get('sql') === 'string' ? (flags.get('sql') as string) : `supabase/publish-${slug}.sql`
  fs.writeFileSync(path.resolve(root, out), publishSql())
  console.log(`✓ SQL записан в ${out} — вставьте его в Supabase → SQL Editor → Run`)
  process.exit(0)
}

const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const { data, error } = await sb.rpc('admin_publish_tenant', { p: payload, p_status: status })
if (error) fail(`публикация не удалась: ${error.message}`)
console.log(`✓ опубликовано: ${JSON.stringify(data)}`)
if (demo) {
  const r = await sb.rpc('admin_seed_demo', { p_slug: slug, p_count: demo })
  if (r.error) fail(`демо-записи не созданы: ${r.error.message}`)
  console.log(`✓ демо-записей: ${r.data}`)
}
console.log(`  Проверка: npm run tenant:verify -- ${slug}`)
