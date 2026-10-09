// Один SQL-файл для первичной настройки через Supabase → SQL Editor (без CLI и пароля БД):
//   npm run setup:sql -- [--tenants pompon,murr] [--demo 8] [--owner pompon:demo@pompon.app:пароль]
// Содержит: все миграции + публикацию студий + демо-записи + (опционально) владельца.
import fs from 'node:fs'
import path from 'node:path'
import { args, fail, listTenants, loadTenant, publishPayload, root, sqlString } from './lib'

const { flags } = args()
const tenants = typeof flags.get('tenants') === 'string' ? String(flags.get('tenants')).split(',') : listTenants()
const demo = flags.has('demo') ? Number(flags.get('demo') === true ? 8 : flags.get('demo')) : 0
const out = typeof flags.get('out') === 'string' ? String(flags.get('out')) : 'supabase/setup.sql'

const migDir = path.join(root, 'supabase', 'migrations')
const migrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
const parts: string[] = [
  '-- Сгенерировано scripts/build-setup-sql.ts. Вставьте целиком в Supabase → SQL Editor → Run.',
  '-- Повторный запуск безопасен только на пустой базе; для обновлений используйте tenant:publish.',
  'begin;',
]
for (const m of migrations) parts.push(`\n-- ═══ ${m} ═══\n` + fs.readFileSync(path.join(migDir, m), 'utf8'))

parts.push('\n-- ═══ Студии ═══')
for (const slug of tenants) {
  const { config, errors } = loadTenant(slug)
  if (errors.length) fail(`${slug}: ${errors.join('; ')}`)
  parts.push(`select public.admin_publish_tenant(${sqlString(JSON.stringify(publishPayload(config)))}::jsonb, 'preview');`)
  if (demo) parts.push(`select public.admin_seed_demo(${sqlString(slug)}, ${demo});`)
}

const owner = flags.get('owner')
if (typeof owner === 'string') {
  const [slug, email, password] = owner.split(':')
  if (!slug || !email || !password) fail('--owner slug:email:password')
  const { ownerSql } = await import('./owner-sql')
  parts.push('\n-- ═══ Владелец ═══\n' + ownerSql(slug, email, password))
}
parts.push('commit;')
fs.writeFileSync(path.resolve(root, out), parts.join('\n') + '\n')
console.log(`✓ ${out}: миграций ${migrations.length}, студий ${tenants.length}${demo ? `, демо-записей по ${demo}` : ''}${owner ? ', владелец' : ''}`)
