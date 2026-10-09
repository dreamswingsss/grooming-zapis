import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@astryxdesign/core/Button'
import { Avatar } from '@astryxdesign/core/Avatar'
import { ChevronLeft, ChevronRight, LogOut, MessageCircle, Phone, Plus, Ban } from 'lucide-react'
import { ownerAddPayment, ownerAgenda, ownerReschedule, ownerSetStatus, type ApiError, type OwnerBooking, type Slot } from '@/lib/api'
import { useCatalog } from '@/lib/tenant'
import { addDays, dayKey, dayLabel, duration, money, priceLabel, relativeDay, timeLabel, zonedToUtc } from '@/lib/time'
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { Field } from '@/components/ui/input'
import { SlotPicker } from '@/components/SlotPicker'
import { Empty, ErrorState, ListSkeleton } from '@/components/states'
import { StatusBadge } from '../client/status'
import { useOwner } from './OwnerRoot'
import { NewBookingSheet } from './NewBookingSheet'
import { cn } from '@/lib/cn'

export default function Agenda() {
  const { tenant, resources } = useCatalog()
  const { tenantId, signOut, email } = useOwner()
  const tz = tenant.timezone
  const today = dayKey(new Date(), tz)
  const [day, setDay] = useState(today)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [master, setMaster] = useState<string | 'all'>('all')

  const from = zonedToUtc(day, '00:00', tz)
  const to = zonedToUtc(addDays(day, 1), '00:00', tz)
  const q = useQuery({
    queryKey: ['owner', 'agenda', tenantId, day],
    queryFn: () => ownerAgenda(tenantId, from, to),
    refetchInterval: 30_000,
  })

  const list = useMemo(() => {
    const b = (q.data?.bookings ?? []).filter((x) => master === 'all' || x.resource_id === master)
    return b
  }, [q.data, master])
  const active = list.filter((b) => b.status !== 'cancelled')
  const expected = active.filter((b) => b.status === 'confirmed').reduce((s, b) => s + b.price, 0)
  const paid = list.reduce((s, b) => s + b.paid, 0)
  const selected = q.data?.bookings.find((b) => b.id === openId) ?? null
  const strip = Array.from({ length: 15 }, (_, i) => addDays(today, i - 3))

  return (
    <main className="px-5 pb-28 pt-[max(env(safe-area-inset-top),16px)]">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-semibold uppercase tracking-wider text-secondary">{tenant.name}</span>
          <h1 className="font-display text-2xl font-semibold first-letter:uppercase">{relativeDay(day, tz)}</h1>
        </div>
        <Button label={`Выйти (${email})`} isIconOnly icon={<LogOut className="size-4" />} variant="ghost" onClick={signOut} />
      </header>

      <div className="mt-4 flex items-center gap-1">
        <Button label="Предыдущий день" isIconOnly size="sm" variant="ghost" icon={<ChevronLeft className="size-4" />} onClick={() => setDay(addDays(day, -1))} />
        <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
          {strip.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === day}
              onClick={() => setDay(d)}
              className={cn(
                'press flex h-14 w-11 shrink-0 flex-col items-center justify-center rounded-xl text-center cursor-pointer',
                d === day ? 'bg-accent-bg text-on-accent' : d === today ? 'bg-elevated-2 text-primary' : 'bg-elevated text-primary',
              )}
            >
              <span className={cn('text-[10px] font-semibold uppercase', d === day ? 'text-on-accent/80' : 'text-secondary')}>{dayLabel(d, tz, { weekday: 'short' })}</span>
              <span className="font-bold tabular">{Number(d.slice(8))}</span>
            </button>
          ))}
        </div>
        <Button label="Следующий день" isIconOnly size="sm" variant="ghost" icon={<ChevronRight className="size-4" />} onClick={() => setDay(addDays(day, 1))} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Kpi label="Записей" value={String(active.length)} />
        <Kpi label="Ожидается" value={money(expected)} hint="по подтверждённым" />
        <Kpi label="Оплачено" value={money(paid)} />
      </div>

      {resources.filter((r) => r.is_active).length > 1 && (
        <div className="no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5">
          {[{ id: 'all', name: 'Все мастера' }, ...resources.filter((r) => r.is_active)].map((r) => (
            <button key={r.id} type="button" aria-pressed={master === r.id} onClick={() => setMaster(r.id)}
              className={cn('press min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold cursor-pointer', master === r.id ? 'border-transparent bg-accent-muted text-accent' : 'border-hairline bg-elevated text-secondary')}>
              {r.name}
            </button>
          ))}
        </div>
      )}

      <section className="mt-5 flex flex-col gap-2.5" aria-label="Записи за день">
        {q.isPending ? (
          <ListSkeleton rows={4} height={84} />
        ) : q.isError ? (
          <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        ) : !list.length && !(q.data.blocks.length) ? (
          <Empty title="Записей нет" description="Новые онлайн-записи появятся здесь автоматически." action={<Button label="Записать клиента" icon={<Plus className="size-4" />} onClick={() => setCreating(true)} />} />
        ) : (
          <>
            {q.data.blocks.filter((b) => master === 'all' || b.resource_id === master).map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-[18px] border border-dashed border-hairline px-4 py-3 text-sm text-secondary">
                <Ban className="size-4" />
                <span className="tabular">{timeLabel(b.starts_at, tz)}–{timeLabel(b.ends_at, tz)}</span>
                <span className="truncate">{resources.find((r) => r.id === b.resource_id)?.name} · {b.note ?? 'Время закрыто'}</span>
              </div>
            ))}
            {list.map((b) => (
              <BookingRow key={b.id} b={b} tz={tz} masterName={resources.find((r) => r.id === b.resource_id)?.name ?? ''} onOpen={() => setOpenId(b.id)} />
            ))}
          </>
        )}
      </section>

      <button
        type="button"
        onClick={() => setCreating(true)}
        aria-label="Записать клиента"
        className="press fixed right-5 bottom-[calc(84px+env(safe-area-inset-bottom))] z-20 flex size-14 items-center justify-center rounded-2xl bg-accent-bg text-on-accent shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)] cursor-pointer"
      >
        <Plus className="size-6" />
      </button>

      <Drawer open={Boolean(selected)} onOpenChange={(o) => !o && setOpenId(null)} repositionInputs={false}>
        <DrawerContent aria-describedby={undefined}>
          {selected && <BookingDetail b={selected} onDone={() => setOpenId(null)} />}
        </DrawerContent>
      </Drawer>
      <NewBookingSheet open={creating} onOpenChange={setCreating} defaultDay={day} />
    </main>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl border border-hairline bg-elevated p-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-secondary">{label}</span>
      <span className="truncate text-lg font-bold tabular">{value}</span>
      {hint && <span className="text-[10px] text-secondary">{hint}</span>}
    </div>
  )
}

function BookingRow({ b, tz, masterName, onOpen }: { b: OwnerBooking; tz: string; masterName: string; onOpen: () => void }) {
  const isNew = Date.now() - new Date(b.created_at).getTime() < 24 * 3600_000 && b.source === 'client'
  return (
    <button type="button" onClick={onOpen}
      className={cn('press flex w-full items-stretch gap-3 rounded-[20px] border border-hairline bg-elevated p-3 text-left cursor-pointer hover:bg-elevated-2', b.status === 'cancelled' && 'opacity-50')}>
      <span className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-elevated-2">
        <span className="font-bold tabular">{timeLabel(b.starts_at, tz)}</span>
        <span className="text-[11px] text-secondary tabular">{timeLabel(b.ends_at, tz)}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">{b.pet_name ?? b.customer_name}</span>
          {isNew && <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[10px] font-bold uppercase text-accent">новая</span>}
        </span>
        <span className="truncate text-[13px] text-secondary">{b.service_name} · {b.variant_label}</span>
        <span className="truncate text-[13px] text-secondary">{[masterName, b.pet_name ? b.customer_name : null, b.pet_breed].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end justify-between">
        <span className="font-bold tabular">{priceLabel(b.price, b.price_is_from)}</span>
        {b.status !== 'confirmed' && <StatusBadge status={b.status} />}
      </span>
    </button>
  )
}

function BookingDetail({ b, onDone }: { b: OwnerBooking; onDone: () => void }) {
  const { tenant, resources } = useCatalog()
  const tz = tenant.timezone
  const qc = useQueryClient()
  const [mode, setMode] = useState<'view' | 'move' | 'pay'>('view')
  const [day, setDay] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [amount, setAmount] = useState(String(Math.max(b.price - b.paid, 0) || ''))
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('card')
  const refresh = () => qc.invalidateQueries({ queryKey: ['owner'] })

  const status = useMutation({
    mutationFn: (s: OwnerBooking['status']) => ownerSetStatus(b.id, s),
    onSuccess: () => { refresh(); toast.success('Статус обновлён') },
    onError: (e) => toast.error((e as ApiError).message),
  })
  const move = useMutation({
    mutationFn: () => ownerReschedule(b.id, slot!.starts_at, slot!.resource_ids.includes(b.resource_id) ? b.resource_id : slot!.resource_ids[0]),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['slots'] }); toast.success('Запись перенесена'); onDone() },
    onError: (e) => toast.error((e as ApiError).message),
  })
  const pay = useMutation({
    mutationFn: () => ownerAddPayment(b.id, Number(amount), method),
    onSuccess: () => { refresh(); toast.success('Оплата добавлена'); setMode('view') },
    onError: (e) => toast.error((e as ApiError).message),
  })

  const phone = b.customer_phone
  const wa = phone.replace(/\D/g, '')
  const master = resources.find((r) => r.id === b.resource_id)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pt-3 pb-1">
        <DrawerTitle className="text-xl first-letter:uppercase">{relativeDay(dayKey(new Date(b.starts_at), tz), tz)}, {timeLabel(b.starts_at, tz)}–{timeLabel(b.ends_at, tz)}</DrawerTitle>
        <DrawerDescription>{b.service_name} · {b.variant_label} · {duration(b.duration_min)}</DrawerDescription>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {mode === 'view' && (
          <div className="mt-3 flex flex-col gap-4">
            <div className="flex items-center gap-2"><StatusBadge status={b.status} />{b.is_demo && <span className="text-xs text-secondary">демо-запись</span>}</div>
            <div className="flex flex-col gap-3 rounded-[20px] border border-hairline bg-elevated p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="font-semibold">{b.customer_name}</span>
                  <a className="text-sm text-accent tabular" href={`tel:${phone}`}>{phone}</a>
                </div>
                <div className="flex gap-2">
                  <Button label="Позвонить" isIconOnly icon={<Phone className="size-4" />} href={`tel:${phone}`} />
                  <Button label="WhatsApp" isIconOnly icon={<MessageCircle className="size-4" />} href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" />
                </div>
              </div>
              {(b.pet_name || b.pet_breed) && <p className="text-sm"><span className="text-secondary">Питомец: </span>{[b.pet_name, b.pet_breed].filter(Boolean).join(', ')}</p>}
              {b.comment && <p className="rounded-xl bg-elevated-2 p-3 text-sm">{b.comment}</p>}
              <div className="flex items-center gap-2 text-sm">
                <Avatar name={master?.name ?? ''} size="sm" tooltip={false} />
                <span>{master?.name}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-2xl border border-hairline bg-elevated p-3"><span className="block text-secondary">Стоимость</span><span className="font-bold tabular">{priceLabel(b.price, b.price_is_from)}</span></div>
              <div className="rounded-2xl border border-hairline bg-elevated p-3"><span className="block text-secondary">Оплачено</span><span className="font-bold tabular">{money(b.paid)}</span></div>
            </div>

            {b.status !== 'cancelled' && (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  {b.status === 'confirmed' && <Button label="Клиент пришёл" variant="primary" width="100%" isLoading={status.isPending && status.variables === 'arrived'} onClick={() => status.mutate('arrived')} />}
                  {(b.status === 'confirmed' || b.status === 'arrived') && <Button label="Выполнено" variant={b.status === 'arrived' ? 'primary' : 'secondary'} width="100%" isLoading={status.isPending && status.variables === 'done'} onClick={() => status.mutate('done')} />}
                  <Button label="Принять оплату" width="100%" onClick={() => setMode('pay')} />
                  {b.status === 'confirmed' && <Button label="Перенести" width="100%" onClick={() => setMode('move')} />}
                  {b.status === 'confirmed' && <Button label="Не пришёл" width="100%" variant="ghost" onClick={() => status.mutate('no_show')} />}
                  {b.status !== 'confirmed' && <Button label="Вернуть в «подтверждена»" width="100%" variant="ghost" onClick={() => status.mutate('confirmed')} />}
                </div>
                {b.status === 'confirmed' && (
                  <Button label="Отменить запись" variant="destructive" width="100%" onClick={() => { if (confirm('Отменить запись? Время освободится.')) status.mutate('cancelled', { onSuccess: onDone }) }} />
                )}
              </div>
            )}
          </div>
        )}

        {mode === 'move' && (
          <div className="mt-3 flex flex-col gap-4">
            <SlotPicker slug={tenant.slug} tz={tz} variantId={b.variant_id} resourceId={null} days={21} day={day} onDay={(d) => { setDay(d); setSlot(null) }} value={slot} onChange={setSlot} />
            <div className="grid grid-cols-2 gap-2">
              <Button label="Назад" width="100%" onClick={() => setMode('view')} />
              <Button label="Перенести" variant="primary" width="100%" isDisabled={!slot} isLoading={move.isPending} onClick={() => move.mutate()} />
            </div>
          </div>
        )}

        {mode === 'pay' && (
          <form className="mt-3 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); pay.mutate() }}>
            <Field label="Сумма, ₽" type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div role="radiogroup" aria-label="Способ оплаты" className="grid grid-cols-3 gap-2">
              {([['card', 'Карта'], ['cash', 'Наличные'], ['transfer', 'Перевод']] as const).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={method === k} onClick={() => setMethod(k)}
                  className={cn('press min-h-11 rounded-xl border text-sm font-semibold cursor-pointer', method === k ? 'border-transparent bg-accent-muted text-accent' : 'border-hairline bg-elevated')}>{l}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button label="Назад" width="100%" onClick={() => setMode('view')} />
              <Button label="Сохранить" type="submit" variant="primary" width="100%" isDisabled={!(Number(amount) > 0)} isLoading={pay.isPending} />
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
