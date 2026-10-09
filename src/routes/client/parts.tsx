import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Clock, Heart, MapPin, MessageCircle, Navigation, Phone, PlusSquare, Scissors, Send, ShieldCheck, Share, Sparkles, X } from 'lucide-react'
import { useCatalog } from '@/lib/tenant'
import { hoursFor, weeklySummary } from '@/lib/hours'
import { dayKey } from '@/lib/time'
import { cn } from '@/lib/cn'

const highlightIcons = [Scissors, ShieldCheck, Sparkles, Heart, Clock, MessageCircle]

export function Highlights() {
  const { tenant } = useCatalog()
  const items = tenant.public_config.highlights
  if (!items.length) return null
  return (
    <section className="mt-10 px-5" aria-labelledby="h-why">
      <h2 id="h-why" className="font-display text-xl font-semibold">Почему к нам</h2>
      <ul className="mt-4 grid grid-cols-2 gap-3">
        {items.map((h, i) => {
          const Icon = highlightIcons[i % highlightIcons.length]
          return (
            <li key={h.title} className="flex flex-col gap-2 rounded-[20px] border border-hairline bg-elevated p-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent-muted text-accent"><Icon className="size-5" strokeWidth={1.8} /></span>
              <span className="font-semibold leading-snug">{h.title}</span>
              <span className="text-[13px] leading-snug text-secondary">{h.text}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function ContactCard({ className }: { className?: string }) {
  const c = useCatalog()
  const cfg = c.tenant.public_config
  const today = hoursFor(c, dayKey(new Date(), c.tenant.timezone))
  const tel = cfg.phone.replace(/[^\d+]/g, '')
  const wa = cfg.whatsapp?.replace(/\D/g, '')
  const tg = cfg.telegram?.replace(/^@/, '')
  return (
    <section className={cn('px-5', className)} aria-labelledby="h-contacts">
      <h2 id="h-contacts" className="font-display text-xl font-semibold">Как нас найти</h2>
      <div className="mt-4 flex flex-col gap-4 rounded-[22px] border border-hairline bg-elevated p-5">
        <div className="flex gap-3">
          <MapPin className="mt-0.5 size-5 shrink-0 text-accent" />
          <div className="flex flex-col">
            <span className="font-semibold">{cfg.city}, {cfg.address}</span>
            {cfg.addressNote && <span className="text-sm text-secondary">{cfg.addressNote}</span>}
          </div>
        </div>
        <div className="flex gap-3">
          <Clock className="mt-0.5 size-5 shrink-0 text-accent" />
          <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {weeklySummary(c).map((r) => (
              <div key={r.days} className="contents">
                <dt className="text-secondary">{r.days}</dt>
                <dd className="tabular">{r.value}</dd>
              </div>
            ))}
            {today.exception && (
              <>
                <dt className="text-accent">Сегодня</dt>
                <dd className="text-accent tabular">{today.ranges.length ? today.ranges.map((r) => `${r.opens}–${r.closes}`).join(', ') : 'выходной'}</dd>
              </>
            )}
          </dl>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {cfg.mapUrl && <Button label="Маршрут" icon={<Navigation className="size-4" />} href={cfg.mapUrl} target="_blank" rel="noopener noreferrer" width="100%" />}
          <Button label="Позвонить" icon={<Phone className="size-4" />} href={`tel:${tel}`} width="100%" />
          {wa && <Button label="WhatsApp" icon={<MessageCircle className="size-4" />} href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" width="100%" />}
          {tg && <Button label="Telegram" icon={<Send className="size-4" />} href={`https://t.me/${tg}`} target="_blank" rel="noopener noreferrer" width="100%" />}
        </div>
      </div>
    </section>
  )
}

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

/** Подсказка «Добавить на главный экран». Не показывается в standalone и после закрытия. */
export function InstallHint() {
  const { tenant } = useCatalog()
  const key = `zapis:${tenant.slug}:install-hint`
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })
  const [bip, setBip] = useState<BIPEvent | null>(null)
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone)
  const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)

  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setBip(e as BIPEvent) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  if (hidden || standalone) return null
  const close = () => { setHidden(true); try { localStorage.setItem(key, '1') } catch { /* ignore */ } }

  return (
    <aside className="mx-5 mt-8 flex items-start gap-3 rounded-[20px] border border-hairline bg-elevated p-4 fade-in" aria-label="Установка приложения">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-muted text-accent"><PlusSquare className="size-5" /></span>
      <div className="flex flex-1 flex-col gap-1">
        <span className="font-semibold">Запись в один тап</span>
        {bip ? (
          <span className="text-[13px] leading-snug text-secondary">Добавьте студию на главный экран — откроется как приложение, без браузера.</span>
        ) : ios ? (
          <span className="text-[13px] leading-snug text-secondary">Нажмите <Share className="inline size-3.5 -translate-y-px" aria-label="Поделиться" /> внизу Safari и выберите «На экран “Домой”».</span>
        ) : (
          <span className="text-[13px] leading-snug text-secondary">Откройте меню браузера и выберите «Добавить на главный экран».</span>
        )}
        {bip && (
          <div className="mt-2">
            <Button label="Установить" size="sm" variant="primary" onClick={async () => { await bip.prompt(); setBip(null); close() }} />
          </div>
        )}
      </div>
      <button type="button" onClick={close} aria-label="Скрыть подсказку" className="press -mr-1 -mt-1 flex size-11 items-center justify-center rounded-full text-secondary hover:bg-elevated-2 cursor-pointer">
        <X className="size-4" />
      </button>
    </aside>
  )
}
