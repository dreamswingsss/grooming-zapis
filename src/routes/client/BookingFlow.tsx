import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@astryxdesign/core/Button'
import { Avatar } from '@astryxdesign/core/Avatar'
import { ArrowLeft, CalendarPlus, Check, ChevronRight, Clock, Sparkles, X } from 'lucide-react'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { AreaField, Field } from '@/components/ui/input'
import { SlotPicker } from '@/components/SlotPicker'
import { ApiError, createBooking, type Booking, type Service, type Slot, type Variant } from '@/lib/api'
import { mediaUrl, useCatalog } from '@/lib/tenant'
import { duration, longDateTime, priceLabel, timeLabel, dayKey, relativeDay } from '@/lib/time'
import { clearPendingKey, contactDraft, pendingKey, rememberBooking, saveContactDraft } from '@/lib/storage'
import { downloadIcs, formatPhone, phoneDigits } from '@/lib/ics'
import { cn } from '@/lib/cn'

type Step = 'service' | 'variant' | 'master' | 'time' | 'contacts' | 'done'

type Ctx = { open: (serviceId?: string, variantId?: string) => void }
const BookingCtx = createContext<Ctx>({ open: () => {} })
export const useBooking = () => useContext(BookingCtx)

export function BookingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; serviceId?: string; variantId?: string; nonce: number }>({ open: false, nonce: 0 })
  const open = useCallback((serviceId?: string, variantId?: string) => setState((s) => ({ open: true, serviceId, variantId, nonce: s.nonce + 1 })), [])
  return (
    <BookingCtx.Provider value={{ open }}>
      {children}
      <Drawer open={state.open} onOpenChange={(o) => setState((s) => ({ ...s, open: o }))} repositionInputs={false}>
        <DrawerContent aria-describedby={undefined}>
          {state.open && (
            <Flow key={state.nonce} initialService={state.serviceId} initialVariant={state.variantId} onClose={() => setState((s) => ({ ...s, open: false }))} />
          )}
        </DrawerContent>
      </Drawer>
    </BookingCtx.Provider>
  )
}

const titles: Record<Step, string> = {
  service: 'Выберите услугу',
  variant: 'Размер питомца',
  master: 'Мастер',
  time: 'Дата и время',
  contacts: 'Контакты',
  done: 'Вы записаны',
}

function Flow({ initialService, initialVariant, onClose }: { initialService?: string; initialVariant?: string; onClose: () => void }) {
  const { tenant, services, resources } = useCatalog()
  const tz = tenant.timezone
  const slug = tenant.slug
  const qc = useQueryClient()
  const active = services.filter((s) => s.is_active && s.variants.some((v) => v.is_active))

  const [serviceId, setServiceId] = useState<string | undefined>(initialService)
  const [variantId, setVariantId] = useState<string | undefined>(initialVariant)
  const [resourceId, setResourceId] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const draft = useMemo(() => contactDraft(slug), [slug])
  const [name, setName] = useState(draft.name)
  const [phone, setPhone] = useState(draft.phone)
  const [petName, setPetName] = useState(draft.petName)
  const [petBreed, setPetBreed] = useState(draft.petBreed)
  const [comment, setComment] = useState('')
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({})
  const [booking, setBooking] = useState<Booking | null>(null)

  const service = active.find((s) => s.id === serviceId)
  const variants = service?.variants.filter((v) => v.is_active) ?? []
  const variant = variants.find((v) => v.id === variantId)
  const eligible = useMemo(() => {
    if (!service) return []
    const act = resources.filter((r) => r.is_active)
    return service.resourceIds.length ? act.filter((r) => service.resourceIds.includes(r.id)) : act
  }, [service, resources])

  const steps = useMemo<Step[]>(() => {
    const s: Step[] = []
    if (!initialService) s.push('service')
    if (variants.length !== 1) s.push('variant')
    if (eligible.length > 1) s.push('master')
    s.push('time', 'contacts', 'done')
    return s
  }, [initialService, variants.length, eligible.length])

  const firstStep: Step = !service ? 'service' : !variant ? (variants.length === 1 ? 'master' : 'variant') : eligible.length > 1 ? 'master' : 'time'
  const [step, setStep] = useState<Step>(steps.includes(firstStep) ? firstStep : steps[0])
  const [dir, setDir] = useState<1 | -1>(1)

  // Единственный вариант выбираем автоматически.
  useEffect(() => {
    if (service && variants.length === 1 && variantId !== variants[0].id) setVariantId(variants[0].id)
  }, [service, variants, variantId])

  const go = (s: Step, d: 1 | -1 = 1) => { setDir(d); setStep(s) }
  const next = () => { const i = steps.indexOf(step); if (i < steps.length - 1) go(steps[i + 1], 1) }
  const back = () => { const i = steps.indexOf(step); if (i > 0) go(steps[i - 1], -1); else onClose() }

  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
    const h = bodyRef.current?.querySelector<HTMLElement>('[data-step-title]')
    h?.focus({ preventScroll: true })
  }, [step])

  const fingerprint = `${variantId}|${slot?.starts_at}|${resourceId ?? 'any'}`
  const submit = useMutation({
    mutationFn: () =>
      createBooking({
        slug,
        variantId: variantId!,
        startsAt: slot!.starts_at,
        resourceId,
        name: name.trim(),
        phone: phoneDigits(phone),
        petName: petName.trim(),
        petBreed: petBreed.trim(),
        comment: comment.trim(),
        idempotencyKey: pendingKey(slug, fingerprint),
      }),
    onSuccess: (b) => {
      clearPendingKey(slug, fingerprint)
      saveContactDraft(slug, { name: name.trim(), phone, petName: petName.trim(), petBreed: petBreed.trim() })
      rememberBooking(slug, { token: b.token, startsAt: b.starts_at, service: b.service_name })
      setBooking(b)
      qc.invalidateQueries({ queryKey: ['slots', slug] })
      qc.invalidateQueries({ queryKey: ['available-days', slug] })
      go('done')
      try { navigator.vibrate?.(30) } catch { /* нет вибро */ }
    },
    onError: (e) => {
      const err = e as ApiError
      if (err.code === 'SLOT_TAKEN' || err.code === 'SLOT_UNAVAILABLE') {
        clearPendingKey(slug, fingerprint)
        toast.error(err.message)
        setSlot(null)
        qc.invalidateQueries({ queryKey: ['slots', slug] })
        go('time', -1)
      } else if (err.code === 'BAD_PHONE') {
        setErrors({ phone: err.message })
      } else {
        toast.error(err.message)
      }
    },
  })

  const validateAndSubmit = () => {
    const e: typeof errors = {}
    if (!name.trim()) e.name = 'Как к вам обращаться?'
    const digits = phoneDigits(phone)
    if (digits.length !== 11) e.phone = 'Нужен номер из 11 цифр: +7 и 10 цифр'
    setErrors(e)
    if (Object.keys(e).length) {
      document.getElementById(e.name ? 'bk-name' : 'bk-phone')?.focus()
      return
    }
    submit.mutate()
  }

  const idx = steps.indexOf(step)
  const progressSteps = steps.filter((s) => s !== 'done')
  const master = resourceId ? resources.find((r) => r.id === resourceId) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Шапка */}
      <header className="flex items-center gap-2 px-3 pt-2 pb-3">
        {step !== 'done' ? (
          <button type="button" onClick={back} aria-label={idx === 0 ? 'Закрыть' : 'Назад'} className="press flex size-11 items-center justify-center rounded-full text-primary hover:bg-elevated cursor-pointer">
            {idx === 0 ? <X className="size-5" /> : <ArrowLeft className="size-5" />}
          </button>
        ) : <span className="size-11" />}
        <div className="flex flex-1 flex-col items-center">
          <DrawerTitle className="text-base">{titles[step]}</DrawerTitle>
          {step !== 'done' && (
            <div className="mt-2 flex gap-1" aria-label={`Шаг ${idx + 1} из ${progressSteps.length}`}>
              {progressSteps.map((s, i) => (
                <span key={s} className={cn('h-1 rounded-full transition-all duration-300', i <= idx ? 'w-6 bg-accent-bg' : 'w-3 bg-white/12')} />
              ))}
            </div>
          )}
        </div>
        <span className="size-11" />
      </header>
      <DrawerDescription className="sr-only">Онлайн-запись: {titles[step]}</DrawerDescription>

      {/* Тело шага */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
        <div key={step} data-step-title tabIndex={-1} aria-label={titles[step]} className={cn('outline-none', dir === 1 ? 'animate-[step-in_280ms_var(--ease-out-expo)_both]' : 'animate-[step-back_280ms_var(--ease-out-expo)_both]')}>

          {step === 'service' && (
            <ServiceList services={active} slug={slug} selected={serviceId} onPick={(s) => { setServiceId(s.id); setVariantId(undefined); setSlot(null); setDay(null); setResourceId(null); setTimeout(() => {
              const vs = s.variants.filter((v) => v.is_active)
              const el = s.resourceIds.length ? s.resourceIds.length : resources.filter((r) => r.is_active).length
              go(vs.length !== 1 ? 'variant' : el > 1 ? 'master' : 'time')
            }, 0) }} />
          )}

          {step === 'variant' && service && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-secondary">{service.name}. Цена и время зависят от размера и шерсти.</p>
              {variants.map((v) => (
                <OptionRow
                  key={v.id}
                  selected={v.id === variantId}
                  onClick={() => { setVariantId(v.id); setSlot(null); setDay(null); next() }}
                  title={v.label}
                  subtitle={v.hint ?? undefined}
                  meta={<><span className="font-bold text-primary tabular">{priceLabel(v.price, v.price_is_from)}</span><span className="text-xs text-secondary">{duration(v.duration_min)}</span></>}
                />
              ))}
            </div>
          )}

          {step === 'master' && (
            <div className="flex flex-col gap-3">
              <OptionRow
                selected={resourceId === null}
                onClick={() => { setResourceId(null); setSlot(null); next() }}
                leading={<span className="flex size-12 items-center justify-center rounded-full bg-accent-muted text-accent"><Sparkles className="size-5" /></span>}
                title="Любой мастер"
                subtitle="Покажем больше свободного времени"
              />
              {eligible.map((r) => (
                <OptionRow
                  key={r.id}
                  selected={resourceId === r.id}
                  onClick={() => { setResourceId(r.id); setSlot(null); next() }}
                  leading={<Avatar name={r.name} src={mediaUrl(slug, r.photo_url, 160)} size="lg" tooltip={false} />}
                  title={r.name}
                  subtitle={r.role_title ?? undefined}
                />
              ))}
            </div>
          )}

          {step === 'time' && variant && (
            <SlotPicker
              slug={slug}
              tz={tz}
              variantId={variant.id}
              resourceId={resourceId}
              days={Math.min(tenant.horizon_days, 21)}
              day={day}
              onDay={(d) => { setDay(d); setSlot(null) }}
              value={slot}
              onChange={setSlot}
            />
          )}

          {step === 'contacts' && variant && slot && service && (
            <form id="bk-form" noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); validateAndSubmit() }}>
              <Summary service={service} variant={variant} startsAt={slot.starts_at} tz={tz} masterName={master?.name ?? 'Любой мастер'} />
              <Field id="bk-name" label="Ваше имя" required autoComplete="given-name" name="name" value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })) }} error={errors.name} />
              <Field id="bk-phone" label="Телефон" required type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 (___) ___-__-__" value={phone} onChange={(e) => { setPhone(formatPhone(e.target.value)); setErrors((x) => ({ ...x, phone: undefined })) }} error={errors.phone} hint="Позвоним, только если что-то изменится" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Кличка" value={petName} onChange={(e) => setPetName(e.target.value)} autoComplete="off" />
                <Field label="Порода" value={petBreed} onChange={(e) => setPetBreed(e.target.value)} autoComplete="off" />
              </div>
              <AreaField label="Комментарий" optional rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: боится фена, колтуны на лапах" />
              <p className="text-xs leading-relaxed text-secondary">Нажимая «Записаться», вы соглашаетесь на обработку имени и телефона для связи по этой записи.</p>
            </form>
          )}

          {step === 'done' && booking && (
            <Done booking={booking} tz={tz} onClose={onClose} />
          )}
        </div>
      </div>

      {/* Нижняя панель действия */}
      {(step === 'time' || step === 'contacts') && (
        <footer className="border-t border-hairline bg-surface px-5 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
          {step === 'time' ? (
            <Button
              key="next"
              label={slot ? `Дальше · ${relativeDay(dayKey(new Date(slot.starts_at), tz), tz).toLowerCase()} в ${timeLabel(slot.starts_at, tz)}` : 'Выберите время'}
              variant="primary"
              size="lg"
              width="100%"
              isDisabled={!slot}
              onClick={next}
              endContent={slot ? <ChevronRight className="size-4" /> : undefined}
            />
          ) : (
            <Button key="submit" label="Записаться" variant="primary" size="lg" width="100%" type="submit" form="bk-form" isLoading={submit.isPending} />
          )}
        </footer>
      )}
    </div>
  )
}

function ServiceList({ services, slug, selected, onPick }: { services: Service[]; slug: string; selected?: string; onPick: (s: Service) => void }) {
  const { tenant } = useCatalog()
  const cats = tenant.public_config.categories
  return (
    <div className="flex flex-col gap-6">
      {cats.map((c) => {
        const list = services.filter((s) => s.category === c.key)
        if (!list.length) return null
        return (
          <section key={c.key} className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-secondary">{c.label}</h3>
            {list.map((s) => {
              const vs = s.variants.filter((v) => v.is_active)
              const min = Math.min(...vs.map((v) => v.price))
              return (
                <OptionRow
                  key={s.id}
                  selected={s.id === selected}
                  onClick={() => onPick(s)}
                  leading={s.photo_url ? <img src={mediaUrl(slug, s.photo_url, 200)} alt="" loading="lazy" className="size-14 shrink-0 rounded-2xl object-cover" /> : undefined}
                  title={s.name}
                  subtitle={vs.length > 1 ? `${vs.length} варианта · ${duration(Math.min(...vs.map((v) => v.duration_min)))}+` : duration(vs[0].duration_min)}
                  meta={<span className="font-bold tabular text-primary">{vs.length > 1 || vs[0].price_is_from ? 'от ' : ''}{priceLabel(min, false)}</span>}
                />
              )
            })}
          </section>
        )
      })}
    </div>
  )
}

export function OptionRow({ title, subtitle, meta, leading, selected, onClick }: { title: string; subtitle?: string; meta?: ReactNode; leading?: ReactNode; selected?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'press flex w-full items-center gap-3 rounded-[20px] border p-3 pr-4 text-left cursor-pointer min-h-[68px]',
        selected ? 'border-accent-bg bg-accent-muted' : 'border-hairline bg-elevated hover:bg-elevated-2',
      )}
    >
      {leading}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold leading-snug text-primary">{title}</span>
        {subtitle && <span className="text-[13px] leading-snug text-secondary">{subtitle}</span>}
      </span>
      {meta ? <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">{meta}</span> : <ChevronRight className="size-4 shrink-0 text-secondary" />}
    </button>
  )
}

function Summary({ service, variant, startsAt, tz, masterName }: { service: Service; variant: Variant; startsAt: string; tz: string; masterName: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-hairline bg-elevated p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-semibold">{service.name}</span>
          <span className="text-[13px] text-secondary">{variant.label} · {masterName}</span>
        </div>
        <span className="font-bold tabular">{priceLabel(variant.price, variant.price_is_from)}</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-primary">
        <Clock className="size-4 text-accent" />
        <span className="first-letter:uppercase">{longDateTime(startsAt, tz)}</span>
        <span className="text-secondary">· {duration(variant.duration_min)}</span>
      </div>
    </div>
  )
}

function Done({ booking, tz, onClose }: { booking: Booking; tz: string; onClose: () => void }) {
  const { tenant } = useCatalog()
  const cfg = tenant.public_config
  const link = `/s/${tenant.slug}/b/${booking.token}`
  return (
    <div className="flex flex-col items-center gap-5 pt-2 text-center">
      <span className="flex size-20 items-center justify-center rounded-full bg-accent-bg text-on-accent animate-[pop_420ms_var(--ease-out-expo)_both]">
        <Check className="size-10" strokeWidth={2.5} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-display text-xl font-semibold first-letter:uppercase">{longDateTime(booking.starts_at, tz)}</p>
        <p className="text-secondary">{booking.service_name} · {booking.variant_label}</p>
        {booking.resource && <p className="text-secondary">Мастер: {booking.resource.name}</p>}
      </div>
      <div className="w-full rounded-[20px] border border-hairline bg-elevated p-4 text-left text-sm">
        <p className="text-primary">{cfg.address}</p>
        {cfg.addressNote && <p className="text-secondary">{cfg.addressNote}</p>}
        <p className="mt-2 text-secondary">Запись сохранена в «Мои записи». Перенести или отменить можно там же.</p>
      </div>
      <div className="flex w-full flex-col gap-2">
        <Button
          label="Добавить в календарь"
          variant="primary"
          size="lg"
          width="100%"
          icon={<CalendarPlus className="size-4" />}
          onClick={() => downloadIcs({
            uid: `${booking.id}@zapis`,
            title: `${tenant.name}: ${booking.service_name}`,
            start: booking.starts_at,
            end: booking.ends_at,
            location: `${cfg.city}, ${cfg.address}`,
            description: `${booking.variant_label}. Запись: ${location.origin}${link}`,
            url: `${location.origin}${link}`,
          })}
        />
        <Link to={link} onClick={onClose} className="press flex h-12 items-center justify-center rounded-2xl text-sm font-semibold text-accent hover:bg-elevated">
          Открыть запись
        </Link>
      </div>
    </div>
  )
}
