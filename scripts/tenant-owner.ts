// Создать владельца студии (публичной регистрации нет):
//   npm run tenant:owner -- <slug> --email owner@mail.ru [--password ...]
// Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY. Без них используйте --sql.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { args, env, fail, root } from './lib'
import { ownerSql } from './owner-sql'

const { pos, flags } = args()
const slug = pos[0] ?? fail('укажите slug')
const email = String(flags.get('email') ?? fail('укажите --email'))
const password = typeof flags.get('password') === 'string' ? String(flags.get('password')) : crypto.randomBytes(9).toString('base64url')

if (flags.has('sql')) {
  // SQL для SQL Editor: создаёт пользователя Auth с подтверждённой почтой и привязывает к студии.
  const out = typeof flags.get('sql') === 'string' ? String(flags.get('sql')) : `supabase/owner-${slug}.sql`
  fs.writeFileSync(path.resolve(root, out), ownerSql(slug, email, password))
  console.log(`✓ SQL записан в ${out}. Логин: ${email}  пароль: ${password}`)
  process.exit(0)
}

const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
let userId: string | undefined
const created = await sb.auth.admin.createUser({ email, password, email_confirm: true })
if (created.error) {
  if (!/already/i.test(created.error.message)) fail(created.error.message)
  const list = await sb.auth.admin.listUsers({ perPage: 1000 })
  userId = list.data.users.find((u) => u.email === email)?.id
  console.log('  пользователь уже существует — пароль не меняю')
} else userId = created.data.user.id
if (!userId) fail('не удалось найти пользователя')
const r = await sb.rpc('admin_add_member', { p_slug: slug, p_user: userId, p_role: 'owner' })
if (r.error) fail(r.error.message)
console.log(`✓ владелец ${email} привязан к ${slug}${created.error ? '' : `, пароль: ${password}`}`)
