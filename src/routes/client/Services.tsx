import { useCatalog, mediaUrl } from '@/lib/tenant'
import { duration, priceLabel } from '@/lib/time'
import { useBooking } from './BookingFlow'
import { Empty } from '@/components/states'

export default function Services() {
  const { tenant, services } = useCatalog()
  const { open } = useBooking()
  const cfg = tenant.public_config
  const active = services.filter((s) => s.is_active && s.variants.some((v) => v.is_active))

  return (
    <main className="mx-auto max-w-[520px] px-5 pb-28 pt-[max(env(safe-area-inset-top),20px)]">
      <h1 className="font-display text-2xl font-semibold">Услуги и цены</h1>
      <p className="mt-1 text-sm text-secondary">Нажмите на размер питомца — сразу перейдём к выбору времени.</p>

      {!active.length && <Empty title="Услуги скоро появятся" description="Позвоните в студию, чтобы записаться." />}

      <nav aria-label="Категории" className="no-scrollbar sticky top-0 z-10 -mx-5 mt-4 flex gap-2 overflow-x-auto bg-body/90 px-5 py-3 backdrop-blur-md">
        {cfg.categories.map((c) => (
          <a key={c.key} href={`#cat-${c.key}`} className="press shrink-0 rounded-full border border-hairline bg-elevated px-4 py-2.5 text-sm font-semibold">
            {c.label}
          </a>
        ))}
      </nav>

      {cfg.categories.map((c) => {
        const list = active.filter((s) => s.category === c.key)
        if (!list.length) return null
        return (
          <section key={c.key} id={`cat-${c.key}`} className="mt-6 flex scroll-mt-20 flex-col gap-4" aria-labelledby={`h-${c.key}`}>
            <h2 id={`h-${c.key}`} className="text-xs font-bold uppercase tracking-wider text-secondary">{c.label}</h2>
            {list.map((s) => (
              <article key={s.id} className="overflow-hidden rounded-[22px] border border-hairline bg-elevated">
                {s.photo_url && (
                  <img src={mediaUrl(tenant.slug, s.photo_url, 900)} alt="" loading="lazy" className="aspect-[16/8] w-full object-cover" />
                )}
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-lg font-semibold leading-snug">{s.name}</h3>
                    {s.description && <p className="text-sm leading-relaxed text-secondary">{s.description}</p>}
                  </div>
                  <ul className="flex flex-col divide-y divide-white/6 rounded-2xl border border-hairline">
                    {s.variants.filter((v) => v.is_active).map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => open(s.id, v.id)}
                          className="press flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left cursor-pointer hover:bg-elevated-2"
                        >
                          <span className="flex flex-1 flex-col">
                            <span className="font-semibold">{v.label}</span>
                            <span className="text-xs text-secondary">{[v.hint, duration(v.duration_min)].filter(Boolean).join(' · ')}</span>
                          </span>
                          <span className="font-bold tabular">{priceLabel(v.price, v.price_is_from)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </section>
        )
      })}
    </main>
  )
}
