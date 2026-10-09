// Интеграционные SQL-тесты на реальном Postgres со схемой проекта (локальный стек или тестовый проект).
//   DATABASE_URL=postgres://postgres:...@host:5432/db npm run test:db
// Тесты создают собственные записи и откатывают изменения там, где это возможно.
import pg from 'pg'
import assert from 'node:assert/strict'

const url = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54322/app'
const pool = new pg.Pool({ connectionString: url, max: 6 })

type Role = { role: 'anon' } | { role: 'authenticated'; sub: string } | { role: 'postgres' }

async function as<T>(r: Role, fn: (c: pg.PoolClient) => Promise<T>, opts: { ip?: string; rollback?: boolean } = {}): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    if (r.role !== 'postgres') {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(r.role === 'authenticated' ? { sub: r.sub, role: 'authenticated' } : { role: 'anon' })])
      await c.query(`set local role ${r.role}`)
    }
    await c.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': opts.ip ?? `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` })])
    const res = await fn(c)
    await c.query(opts.rollback ? 'rollback' : 'commit')
    return res
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

const anon: Role = { role: 'anon' }
const admin: Role = { role: 'postgres' }

async function rejects(p: Promise<unknown>, code: string) {
  try {
    await p
  } catch (e) {
    const m = (e as Error).message
    assert.ok(m.includes(code), `ожидали ${code}, получили: ${m}`)
    return
  }
  assert.fail(`ожидали ошибку ${code}, но запрос прошёл`)
}

let passed = 0
const failures: string[] = []
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures.push(name)
    console.log(`  ✗ ${name}\n      ${(e as Error).message.split('\n').join('\n      ')}`)
  }
}

// ───────── Подготовка ─────────
async function variant(slug: string, service: string, key: string) {
  const { rows } = await pool.query(
    `select v.id, v.price, v.duration_min, s.buffer_min, t.id as tenant_id from service_variants v
       join services s on s.id = v.service_id join tenants t on t.id = v.tenant_id
      where t.slug = $1 and s.key = $2 and v.key = $3`, [slug, service, key])
  assert.ok(rows[0], `нет варианта ${slug}/${service}/${key}`)
  return rows[0] as { id: string; price: number; duration_min: number; buffer_min: number; tenant_id: string }
}
async function resource(slug: string, key: string) {
  const { rows } = await pool.query(`select r.id from resources r join tenants t on t.id = r.tenant_id where t.slug = $1 and r.key = $2`, [slug, key])
  return rows[0].id as string
}
/** Свободный старт, где свободны все указанные мастера (ищем вперёд по дням). */
async function freeSlot(slug: string, variantId: string, needResources: string[] = [], skip = 0): Promise<string> {
  for (let d = 2; d < 25; d++) {
    const { rows } = await pool.query(`select starts_at, resource_ids from public.get_slots($1, $2, (now() + make_interval(days => $3))::date)`, [slug, variantId, d])
    const ok = rows.filter((r) => needResources.every((x) => (r.resource_ids as string[]).includes(x)))
    if (ok.length > skip) return (ok[skip].starts_at as Date).toISOString()
  }
  throw new Error('нет свободных слотов')
}
const key = () => crypto.randomUUID()
const book = (c: pg.PoolClient, slug: string, v: string, start: string, res: string | null, k = key(), phone = '+79001234567') =>
  c.query(`select public.create_booking($1, $2, $3, 'Тест', $4, $5, $6, 'Бобик', 'Шпиц', null) as b`, [slug, v, start, phone, k, res]).then((r) => r.rows[0].b)

const ownerId = async (slug: string) => (await pool.query(`select m.user_id from tenant_members m join tenants t on t.id = m.tenant_id where t.slug = $1 limit 1`, [slug])).rows[0]?.user_id as string

// ───────── Тесты ─────────
console.log('SQL-тесты: ' + url.replace(/:[^:@/]+@/, ':***@'))

const complexMini = await variant('pompon', 'complex', 'mini')
const alina = await resource('pompon', 'alina')
const polina = await resource('pompon', 'polina')
const owner = await ownerId('pompon')
assert.ok(owner, 'нет владельца pompon — сгенерируйте setup.sql с --owner')

await test('конкурентная запись к одному мастеру: ровно одна проходит', async () => {
  const start = await freeSlot('pompon', complexMini.id, [alina])
  const results = await Promise.allSettled([1, 2, 3, 4].map(() => as(anon, (c) => book(c, 'pompon', complexMini.id, start, alina))))
  const ok = results.filter((r) => r.status === 'fulfilled')
  const bad = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  assert.equal(ok.length, 1, `успешных: ${ok.length}`)
  for (const b of bad) assert.match(String(b.reason.message), /SLOT_TAKEN/)
})

await test('два ресурса: «любой мастер» занимает обоих, третья запись — SLOT_TAKEN', async () => {
  const start = await freeSlot('pompon', complexMini.id, [alina, polina], 1)
  const a = await as(anon, (c) => book(c, 'pompon', complexMini.id, start, null))
  const b = await as(anon, (c) => book(c, 'pompon', complexMini.id, start, null))
  assert.notEqual(a.resource.id, b.resource.id)
  await rejects(as(anon, (c) => book(c, 'pompon', complexMini.id, start, null)), 'SLOT_TAKEN')
})

await test('буфер после услуги учитывается: следующий слот у мастера сдвигается', async () => {
  const start = await freeSlot('pompon', complexMini.id, [alina], 3)
  await as(anon, (c) => book(c, 'pompon', complexMini.id, start, alina))
  const endWithBuffer = new Date(new Date(start).getTime() + (complexMini.duration_min + complexMini.buffer_min) * 60000)
  const { rows } = await pool.query(`select starts_at, resource_ids from get_slots('pompon', $1, ($2::timestamptz at time zone 'Asia/Yekaterinburg')::date)`, [complexMini.id, start])
  for (const r of rows) {
    const s = new Date(r.starts_at)
    const e = new Date(s.getTime() + (complexMini.duration_min + complexMini.buffer_min) * 60000)
    if ((r.resource_ids as string[]).includes(alina)) assert.ok(e <= new Date(start) || s >= endWithBuffer, `пересечение в ${s.toISOString()}`)
  }
})

await test('многодневная занятость (блок через полночь) убирает слоты в обоих днях', async () => {
  await as({ role: 'authenticated', sub: owner }, async (c) => {
    // Ищем пару дней, где у Алины нет записей в этом окне.
    let d = ''
    for (let i = 8; i < 28 && !d; i++) {
      const day = (await c.query(`select ((now() at time zone 'Asia/Yekaterinburg')::date + $1::int)::text d`, [i])).rows[0].d as string
      await c.query('savepoint s')
      try {
        await c.query(`select owner_block($1, $2, ($3::date + time '15:00') at time zone 'Asia/Yekaterinburg', ($3::date + 1 + time '13:00') at time zone 'Asia/Yekaterinburg', 'двухдневный блок')`, [complexMini.tenant_id, alina, day])
        d = day
      } catch {
        await c.query('rollback to savepoint s')
      }
    }
    assert.ok(d, 'не нашли свободной пары дней')
    const day1 = await c.query(`select count(*)::int n from get_slots('pompon', $1, $2::date) where $3 = any(resource_ids) and starts_at >= ($2::date + time '13:00') at time zone 'Asia/Yekaterinburg'`, [complexMini.id, d, alina])
    const day2 = await c.query(`select count(*)::int n from get_slots('pompon', $1, $2::date + 1) where $3 = any(resource_ids) and starts_at < ($2::date + 1 + time '13:00') at time zone 'Asia/Yekaterinburg'`, [complexMini.id, d, alina])
    assert.equal(day1.rows[0].n, 0, 'в первый день после 13:00 у Алины не должно быть слотов (услуга 2 ч пересекает блок)')
    assert.equal(day2.rows[0].n, 0, 'во второй день до 13:00 у Алины не должно быть слотов')
  }, { rollback: true })
})

await test('блокировка: запись в закрытое время запрещена, блок поверх записи — OVERLAPS_BOOKING', async () => {
  const start = await freeSlot('pompon', complexMini.id, [alina], 5)
  await as({ role: 'authenticated', sub: owner }, async (c) => {
    await c.query(`select owner_block($1, $2, $3::timestamptz, $3::timestamptz + interval '1 hour', 'обед')`, [complexMini.tenant_id, alina, start])
  }, { rollback: false })
  await rejects(as(anon, (c) => book(c, 'pompon', complexMini.id, start, alina)), 'SLOT_TAKEN')
  const later = await freeSlot('pompon', complexMini.id, [alina], 9)
  await as(anon, (c) => book(c, 'pompon', complexMini.id, later, alina))
  await rejects(as({ role: 'authenticated', sub: owner }, (c) => c.query(`select owner_block($1, $2, $3::timestamptz, $3::timestamptz + interval '30 min', null)`, [complexMini.tenant_id, alina, later])), 'OVERLAPS_BOOKING')
})

await test('перенос: удачный меняет время; неудачный не теряет исходную запись', async () => {
  const s1 = await freeSlot('pompon', complexMini.id, [alina], 11)
  const b = await as(anon, (c) => book(c, 'pompon', complexMini.id, s1, alina))
  const s2 = await freeSlot('pompon', complexMini.id, [alina], 13)
  const moved = await as(anon, (c) => c.query(`select reschedule_booking($1, $2, $3) b`, [b.token, s2, alina]).then((r) => r.rows[0].b))
  assert.equal(new Date(moved.starts_at).toISOString(), s2)
  // Занимаем s3 другим клиентом и пытаемся туда перенести.
  const s3 = await freeSlot('pompon', complexMini.id, [alina], 15)
  await as(anon, (c) => book(c, 'pompon', complexMini.id, s3, alina))
  await rejects(as(anon, (c) => c.query(`select reschedule_booking($1, $2, $3)`, [b.token, s3, alina])), 'SLOT_TAKEN')
  const after = await as(anon, (c) => c.query(`select get_booking($1) b`, [b.token]).then((r) => r.rows[0].b))
  assert.equal(new Date(after.starts_at).toISOString(), s2, 'запись должна остаться на прежнем времени')
  const occ = await pool.query(`select lower(period) l from resource_occupancies where booking_id = $1`, [b.id])
  assert.equal(new Date(occ.rows[0].l).toISOString(), s2, 'занятость должна остаться прежней')
})

await test('идемпотентность: повтор с тем же ключом возвращает ту же запись и тот же токен', async () => {
  const start = await freeSlot('pompon', complexMini.id, [polina], 2)
  const k = key()
  const a = await as(anon, (c) => book(c, 'pompon', complexMini.id, start, polina, k))
  const b = await as(anon, (c) => book(c, 'pompon', complexMini.id, start, polina, k))
  assert.equal(a.id, b.id)
  assert.equal(a.token, b.token)
  const n = await pool.query(`select count(*)::int n from bookings where idempotency_key = $1`, [k])
  assert.equal(n.rows[0].n, 1)
  const stored = await pool.query(`select access_token_hash, encode(access_token_hash,'hex') h from bookings where id = $1`, [a.id])
  assert.ok(!stored.rows[0].h.includes(Buffer.from(a.token).toString('hex')), 'в БД не должен лежать сам токен')
})

await test('клиент не задаёт цену, длительность и tenant: чужой вариант через другой slug отклоняется', async () => {
  const murrVar = await variant('murr', 'wash', 'short')
  const start = await freeSlot('pompon', complexMini.id, [], 0)
  await rejects(as(anon, (c) => book(c, 'pompon', murrVar.id, start, null)), 'SERVICE_NOT_FOUND')
  await rejects(as(anon, (c) => c.query(`select create_booking('pompon', $1, now() + interval '3 hours' + interval '7 minutes', 'X', '+79001112233', $2)`, [complexMini.id, key()])), 'SLOT_UNAVAILABLE')
})

await test('RLS: anon не видит записи, платежи, занятость, токены; не вызывает owner_* и admin_*', async () => {
  for (const t of ['bookings', 'payments', 'resource_occupancies', 'tenant_members']) {
    await rejects(as(anon, (c) => c.query(`select * from ${t} limit 1`)), 'permission denied')
  }
  await rejects(as(anon, (c) => c.query(`select owner_stats($1, current_date - 7, current_date)`, [complexMini.tenant_id])), 'permission denied')
  await rejects(as(anon, (c) => c.query(`select admin_publish_tenant('{}'::jsonb)`)), 'permission denied')
  await rejects(as(anon, (c) => c.query(`select * from private.secrets`)), 'permission denied')
})

await test('изоляция тенантов: владелец pompon не видит и не меняет данные murr', async () => {
  const murrVar = await variant('murr', 'wash', 'short')
  const ownerRole: Role = { role: 'authenticated', sub: owner }
  const seen = await as(ownerRole, (c) => c.query(`select distinct tenant_id from bookings`).then((r) => r.rows.map((x) => x.tenant_id)))
  assert.deepEqual(seen, [complexMini.tenant_id])
  const murrBooking = (await pool.query(`select id from bookings where tenant_id = $1 limit 1`, [murrVar.tenant_id])).rows[0].id
  await rejects(as(ownerRole, (c) => c.query(`select owner_set_status($1, 'done')`, [murrBooking])), 'FORBIDDEN')
  await rejects(as(ownerRole, (c) => c.query(`select owner_agenda($1, now(), now() + interval '1 day')`, [murrVar.tenant_id])), 'FORBIDDEN')
  await rejects(as(ownerRole, (c) => c.query(`select owner_update_variant($1, 1, 60, true)`, [murrVar.id])), 'FORBIDDEN')
  const stranger: Role = { role: 'authenticated', sub: crypto.randomUUID() }
  await rejects(as(stranger, (c) => c.query(`select owner_stats($1, current_date - 7, current_date)`, [complexMini.tenant_id])), 'FORBIDDEN')
})

await test('историческая цена: изменение прайса не меняет цену созданной записи', async () => {
  const start = await freeSlot('pompon', complexMini.id, [polina], 4)
  const b = await as(anon, (c) => book(c, 'pompon', complexMini.id, start, polina))
  await as({ role: 'authenticated', sub: owner }, (c) => c.query(`select owner_update_variant($1, 9999, $2, true)`, [complexMini.id, complexMini.duration_min]), { rollback: true })
  await as({ role: 'authenticated', sub: owner }, async (c) => {
    await c.query(`select owner_update_variant($1, 9999, $2, true)`, [complexMini.id, complexMini.duration_min])
    const p = await c.query(`select price from bookings where id = $1`, [b.id])
    assert.equal(p.rows[0].price, complexMini.price)
  }, { rollback: true })
})

await test('платежи и статистика: оплата ≠ выручка по прайсу ≠ ожидание', async () => {
  const start = await freeSlot('pompon', complexMini.id, [polina], 6)
  const b = await as(anon, (c) => book(c, 'pompon', complexMini.id, start, polina))
  await as({ role: 'authenticated', sub: owner }, async (c) => {
    const before = (await c.query(`select owner_stats($1, current_date - 1, current_date + 40) s`, [complexMini.tenant_id])).rows[0].s
    await c.query(`select owner_set_status($1, 'done')`, [b.id])
    await c.query(`select owner_add_payment($1, 1000, 'card')`, [b.id])
    const after = (await c.query(`select owner_stats($1, current_date - 1, current_date + 40) s`, [complexMini.tenant_id])).rows[0].s
    assert.equal(after.completed - before.completed, 1)
    assert.equal(after.completed_value - before.completed_value, complexMini.price)
    assert.equal(after.paid_total - before.paid_total, 1000, 'учитываются только реальные платежи')
    assert.equal(before.expected_value - after.expected_value, complexMini.price, 'выполненная запись уходит из «ожидается»')
  }, { rollback: true })
})

await test('отмена по токену освобождает время; плохой токен — BOOKING_NOT_FOUND', async () => {
  const start = await freeSlot('pompon', complexMini.id, [alina], 17)
  const b = await as(anon, (c) => book(c, 'pompon', complexMini.id, start, alina))
  await as(anon, (c) => c.query(`select cancel_booking($1)`, [b.token]))
  const again = await as(anon, (c) => book(c, 'pompon', complexMini.id, start, alina))
  assert.ok(again.id)
  await rejects(as(anon, (c) => c.query(`select get_booking('x'||repeat('a', 30))`)), 'BOOKING_NOT_FOUND')
})

await test('часовой пояс: слоты murr начинаются в 11:00 по Москве', async () => {
  const v = await variant('murr', 'wash', 'short')
  const { rows } = await pool.query(
    `select min(to_char(s.starts_at at time zone 'Europe/Moscow', 'HH24:MI')) t
       from generate_series(3, 9) g
       cross join lateral (select ((now() at time zone 'Europe/Moscow')::date + g) as d) x
       cross join lateral get_slots('murr', $1, x.d) s
      where extract(isodow from x.d) between 2 and 6`, [v.id])
  assert.equal(rows[0].t, '11:00')
})

await test('ограничение частоты: больше 20 записей с одного IP за 10 минут — RATE_LIMITED', async () => {
  const ip = `203.0.113.${Math.floor(Math.random() * 200)}`
  const extra = await variant('pompon', 'claws', 'any')
  let limited = false
  const made: string[] = []
  try {
    for (let i = 0; i < 25 && !limited; i++) {
      try {
        const start = await freeSlot('pompon', extra.id, [], 0)
        const b = await as(anon, (c) => book(c, 'pompon', extra.id, start, null, key(), '+7900555' + String(1000 + i)), { ip })
        made.push(b.id)
      } catch (e) {
        if (String((e as Error).message).includes('RATE_LIMITED')) limited = true
        else throw e
      }
    }
    assert.ok(limited, 'лимит не сработал')
    assert.equal(made.length, 20)
  } finally {
    await pool.query(`delete from bookings where id = any($1::uuid[])`, [made])
  }
})

await test('переиздание конфига сохраняет записи; удалённая услуга деактивируется', async () => {
  const before = (await pool.query(`select count(*)::int n from bookings where tenant_id = $1`, [complexMini.tenant_id])).rows[0].n
  await as(admin, async (c) => {
    const cfg = (await c.query(`select public_config from tenants where slug = 'pompon'`)).rows[0]
    void cfg
    await c.query(`select admin_publish_tenant($1::jsonb, null)`, [JSON.stringify({
      slug: 'pompon', name: 'Помпон', hours: [{ days: [1, 2, 3, 4, 5, 6, 7], opens: '10:00', closes: '20:00' }],
      resources: [{ key: 'alina', name: 'Алина' }],
      services: [{ key: 'complex', category: 'dogs', name: 'Комплекс', variants: [{ key: 'mini', label: 'Мини', price: 1, durationMin: 120 }] }],
      public: {},
    })])
    const n = (await c.query(`select count(*)::int n from bookings where tenant_id = $1`, [complexMini.tenant_id])).rows[0].n
    assert.equal(n, before)
    const spa = (await c.query(`select is_active from services where tenant_id = $1 and key = 'spa'`, [complexMini.tenant_id])).rows[0]
    assert.equal(spa.is_active, false)
    const price = (await c.query(`select price from bookings where tenant_id = $1 and variant_id = $2 limit 1`, [complexMini.tenant_id, complexMini.id])).rows[0]
    assert.equal(price.price, complexMini.price)
  }, { rollback: true })
})

await pool.end()
console.log(`\n${passed} прошло, ${failures.length} упало`)
process.exit(failures.length ? 1 : 0)
