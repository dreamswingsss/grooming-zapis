// Новая студия из шаблона:
// npm run tenant:new -- <slug> --name "ProХвост" [--from pompon] [--phone "+7 ..."] [--address "..."]
//   [--city "Екатеринбург"] [--accent "#7FB3FF"] [--whatsapp 7982...] [--telegram @...] [--rating 5 --reviews 175 --rating-source 2ГИС]
import fs from 'node:fs'
import path from 'node:path'
import { args, fail, loadTenant, tenantDir } from './lib'

const { pos, flags } = args()
const slug = pos[0]
if (!slug || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) fail('укажите slug латиницей: npm run tenant:new -- prohvost --name "ProХвост"')
const from = String(flags.get('from') ?? 'pompon')
const dir = tenantDir(slug)
if (fs.existsSync(dir)) fail(`папка tenants/${slug} уже есть`)

const base = loadTenant(from)
if (base.errors.length) fail(`шаблон ${from} невалиден: ${base.errors.join('; ')}`)
const c = structuredClone(base.config)
const str = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined)

c.slug = slug
c.name = str('name') ?? c.name
c.public.logoText = (str('logo') ?? c.name.replace(/[«»"]/g, '').split(/\s+/).slice(-1)[0]).toUpperCase().slice(0, 24)
if (str('city')) c.public.city = str('city')!
if (str('address')) { c.public.address = str('address')!; delete c.public.addressNote }
if (str('phone')) c.public.phone = str('phone')!
if (str('whatsapp')) c.public.whatsapp = str('whatsapp')!
else delete c.public.whatsapp
if (str('telegram')) c.public.telegram = str('telegram')!
else delete c.public.telegram
if (str('accent')) c.public.accent = str('accent')!
if (str('map')) c.public.mapUrl = str('map')!
if (str('rating') && str('reviews')) {
  c.public.rating = { value: Number(str('rating')), count: Number(str('reviews')), source: str('rating-source') ?? '2ГИС' }
}

fs.mkdirSync(path.join(dir, 'media'), { recursive: true })
fs.writeFileSync(path.join(dir, 'business.json'), JSON.stringify(c, null, 2) + '\n')
const check = loadTenant(slug)
if (check.errors.length) fail(`созданный конфиг невалиден: ${check.errors.join('; ')}`)
console.log(`✓ tenants/${slug}/business.json создан из «${from}».`)
console.log('  Дальше: поправьте цены/фото → npm run tenant:validate → npm run tenant:publish -- ' + slug)
