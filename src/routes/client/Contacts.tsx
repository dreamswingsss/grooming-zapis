import { useCatalog } from '@/lib/tenant'
import { ContactCard } from './parts'

export default function Contacts() {
  const { tenant } = useCatalog()
  const cfg = tenant.public_config
  return (
    <main className="mx-auto max-w-[520px] pb-28 pt-[max(env(safe-area-inset-top),20px)]">
      <div className="px-5">
        <h1 className="font-display text-2xl font-semibold">{tenant.name}</h1>
        {cfg.description && <p className="mt-2 text-[15px] leading-relaxed text-secondary">{cfg.description}</p>}
      </div>
      <ContactCard className="mt-6" />
    </main>
  )
}
