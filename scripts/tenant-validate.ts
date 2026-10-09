// npm run tenant:validate -- <slug>   |   npm run tenant:validate -- --all
import { args, listTenants, loadTenant } from './lib'

const { pos, flags } = args()
const slugs = flags.has('all') || !pos.length ? listTenants() : pos
let bad = 0
for (const slug of slugs) {
  const { config, errors } = loadTenant(slug)
  if (errors.length) {
    bad++
    console.error(`✗ ${slug}`)
    for (const e of errors) console.error(`   · ${e}`)
  } else {
    const variants = config.services.reduce((n, s) => n + s.variants.length, 0)
    console.log(`✓ ${slug}: «${config.name}», мастеров ${config.resources.length}, услуг ${config.services.length}, вариантов ${variants}`)
  }
}
if (!slugs.length) console.error('Нет ни одной студии в tenants/')
process.exit(bad || !slugs.length ? 1 : 0)
