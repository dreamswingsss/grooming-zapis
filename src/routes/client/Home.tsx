import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@astryxdesign/core/Button'
import { Avatar } from '@astryxdesign/core/Avatar'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { ArrowRight, CalendarCheck2, MapPin, Phone, Star } from 'lucide-react'
import { useCatalog, mediaUrl } from '@/lib/tenant'
import { openStatus } from '@/lib/hours'
import { duration, priceLabel } from '@/lib/time'
import { useBooking } from './BookingFlow'
import { ContactCard, Highlights, InstallHint } from './parts'
import { cn } from '@/lib/cn'

export default function Home() {
  const c = useCatalog()
  const { tenant, services, resources } = c
  const cfg = tenant.public_config
  const { open } = useBooking()
  const status = openStatus(c)
  const [cat, setCat] = useState(cfg.categories[0]?.key ?? '')
  const heroCta = useRef<HTMLDivElement>(null)
  const [floating, setFloating] = useState(false)

  useEffect(() => {
    const el = heroCta.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setFloating(!e.isIntersecting), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const visible = services.filter((s) => s.is_active && s.category === cat && s.variants.some((v) => v.is_active))
  const masters = resources.filter((r) => r.is_active)

  return (
    <main className="pb-32">
      {/* Обложка */}
      <section className="relative isolate">
        <div className="relative h-[min(64dvh,540px)] min-h-[420px] overflow-hidden">
          <img
            src={mediaUrl(tenant.slug, cfg.heroImage, 1400)}
            alt={cfg.heroAlt}
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover animate-[hero_1.2s_var(--ease-out-expo)_both]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(12,11,10,0.55)_0%,rgba(12,11,10,0)_28%,rgba(12,11,10,0.15)_52%,var(--color-background-body)_100%)]" />
        </div>
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5 pt-[max(env(safe-area-inset-top),14px)]">
          <span className="font-display text-[15px] font-semibold tracking-wide text-white drop-shadow">{cfg.logoText ?? tenant.name}</span>
          {tenant.status === 'preview' && (
            <span className="rounded-full border border-white/20 bg-black/35 px-3 py-1 text-[11px] font-semibold text-white/90 backdrop-blur-md">Демо-версия</span>
          )}
        </div>
        <div className="relative -mt-40 flex flex-col gap-4 px-5">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-hairline bg-black/30 px-3 py-1.5 text-xs font-semibold backdrop-blur-md">
            <span className={cn('size-2 rounded-full', status.open ? 'bg-[#4ADE80]' : 'bg-white/40')} aria-hidden />
            {status.text}
          </span>
          <h1 className="font-display text-[34px] leading-[1.05] font-semibold tracking-tight text-primary text-balance rise-in">{tenant.name}</h1>
          <p className="max-w-[34ch] text-[17px] leading-relaxed text-secondary rise-in [animation-delay:60ms]">{cfg.tagline}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-secondary">
            <span className="inline-flex items-center gap-1.5"><MapPin className="size-4 text-accent" />{cfg.address}</span>
            {cfg.rating && (
              <span className="inline-flex items-center gap-1.5"><Star className="size-4 fill-current text-accent" />{cfg.rating.value.toFixed(1)} · {cfg.rating.count} отзывов в {cfg.rating.source}</span>
            )}
          </div>
          <div ref={heroCta} className="mt-1 flex gap-3">
            <div className="flex-1">
              <Button label="Записаться онлайн" variant="primary" size="lg" width="100%" icon={<CalendarCheck2 className="size-5" />} onClick={() => open()} />
            </div>
            <Button label="Позвонить" isIconOnly size="lg" icon={<Phone className="size-5" />} href={`tel:${cfg.phone.replace(/[^\d+]/g, '')}`} />
          </div>
        </div>
      </section>

      <InstallHint />

      {/* Услуги */}
      <section className="mt-10 flex flex-col gap-4 px-5" aria-labelledby="h-services">
        <div className="flex items-end justify-between">
          <h2 id="h-services" className="font-display text-xl font-semibold">Услуги и цены</h2>
          <Link to="services" className="press inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent">Все <ArrowRight className="size-4" /></Link>
        </div>
        {cfg.categories.length > 1 && (
          <SegmentedControl label="Категория" value={cat} onChange={setCat} layout="fill">
            {cfg.categories.map((k) => <SegmentedControlItem key={k.key} value={k.key} label={k.label} />)}
          </SegmentedControl>
        )}
        <div className="flex flex-col gap-3" key={cat}>
          {visible.slice(0, 4).map((s, i) => {
            const vs = s.variants.filter((v) => v.is_active)
            const min = Math.min(...vs.map((v) => v.price))
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => open(s.id)}
                className="press group flex items-stretch gap-4 overflow-hidden rounded-[22px] border border-hairline bg-elevated text-left rise-in cursor-pointer hover:bg-elevated-2"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {s.photo_url && (
                  <img src={mediaUrl(tenant.slug, s.photo_url, 360)} alt="" loading="lazy" className="w-[104px] shrink-0 object-cover" />
                )}
                <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-4 pr-4">
                  <span className="font-semibold leading-snug">{s.name}</span>
                  {s.description && <span className="line-clamp-2 text-[13px] leading-snug text-secondary">{s.description}</span>}
                  <span className="mt-1 flex items-center gap-2 text-sm">
                    <span className="font-bold tabular">{vs.length > 1 || vs[0].price_is_from ? 'от ' : ''}{priceLabel(min, false)}</span>
                    <span className="text-secondary">· {duration(Math.min(...vs.map((v) => v.duration_min)))}</span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <Highlights />

      {/* Мастера */}
      {masters.length > 0 && (
        <section className="mt-10 flex flex-col gap-4" aria-labelledby="h-team">
          <h2 id="h-team" className="px-5 font-display text-xl font-semibold">Мастера</h2>
          <ul className="no-scrollbar flex gap-3 overflow-x-auto px-5 pb-1">
            {masters.map((r) => (
              <li key={r.id} className="flex w-[168px] shrink-0 flex-col gap-3 rounded-[22px] border border-hairline bg-elevated p-4">
                <Avatar name={r.name} src={mediaUrl(tenant.slug, r.photo_url, 200)} size="lg" tooltip={false} />
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">{r.name}</span>
                  {r.role_title && <span className="text-[13px] text-secondary">{r.role_title}</span>}
                </div>
                {r.bio && <p className="line-clamp-3 text-[13px] leading-snug text-secondary">{r.bio}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Работы */}
      {cfg.gallery.length > 0 && (
        <section className="mt-10 flex flex-col gap-4 px-5" aria-labelledby="h-gallery">
          <h2 id="h-gallery" className="font-display text-xl font-semibold">Наши подопечные</h2>
          <div className="grid grid-cols-2 gap-3">
            {cfg.gallery.slice(0, 6).map((g, i) => (
              <figure key={g.src} className={cn('relative overflow-hidden rounded-[20px] bg-elevated', i % 3 === 0 ? 'row-span-2 aspect-[3/4.2]' : 'aspect-square')}>
                <img src={mediaUrl(tenant.slug, g.src, 600)} alt={g.alt} loading="lazy" className="size-full object-cover" />
                {g.caption && (
                  <figcaption className="absolute inset-x-2 bottom-2 rounded-xl bg-black/45 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur-md">{g.caption}</figcaption>
                )}
              </figure>
            ))}
          </div>
        </section>
      )}

      {cfg.faq.length > 0 && (
        <section className="mt-10 flex flex-col gap-3 px-5" aria-labelledby="h-faq">
          <h2 id="h-faq" className="font-display text-xl font-semibold">Частые вопросы</h2>
          {cfg.faq.map((f) => (
            <details key={f.q} className="group rounded-[20px] border border-hairline bg-elevated px-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                {f.q}
                <span aria-hidden className="text-xl leading-none text-accent transition-transform duration-200 group-open:rotate-45">+</span>
              </summary>
              <p className="pb-4 text-[15px] leading-relaxed text-secondary">{f.a}</p>
            </details>
          ))}
        </section>
      )}

      <ContactCard className="mt-10" />

      <footer className="mt-10 flex flex-col items-center gap-2 px-5 text-center text-xs text-secondary/80">
        {cfg.photoCredit && <span>{cfg.photoCredit}</span>}
      </footer>

      {/* Плавающая кнопка записи после прокрутки обложки */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-[520px] justify-center px-5 transition-all duration-300',
          floating ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
        )}
      >
        <Button label="Записаться" variant="primary" size="lg" elevation="high" width="100%" icon={<CalendarCheck2 className="size-5" />} onClick={() => open()} />
      </div>
    </main>
  )
}
