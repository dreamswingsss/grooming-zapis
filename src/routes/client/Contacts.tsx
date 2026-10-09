import { Link } from 'react-router'
import { ChevronRight, LockKeyhole } from 'lucide-react'
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
      <div className="mt-8 px-5">
        <Link
          to={`/s/${tenant.slug}/owner`}
          className="press flex min-h-14 items-center gap-3 rounded-[20px] border border-hairline bg-elevated px-4 hover:bg-elevated-2"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-muted text-accent"><LockKeyhole className="size-5" /></span>
          <span className="flex flex-1 flex-col">
            <span className="font-semibold">Вход для студии</span>
            <span className="text-[13px] text-secondary">Кабинет владельца: записи, график, цены</span>
          </span>
          <ChevronRight className="size-4 text-secondary" />
        </Link>
      </div>
    </main>
  )
}
