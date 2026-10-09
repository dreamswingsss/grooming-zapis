import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@astryxdesign/core/Button'
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { ArrowLeft, CalendarPlus, Clock, MapPin, PawPrint, User } from 'lucide-react'
import { cancelBooking, getBooking, rescheduleBooking, type ApiError, type Slot } from '@/lib/api'
import { useCatalog } from '@/lib/tenant'
import { duration, longDateTime, priceLabel } from '@/lib/time'
import { rememberBooking } from '@/lib/storage'
import { downloadIcs } from '@/lib/ics'
import { ErrorState, ListSkeleton } from '@/components/states'
import { SlotPicker } from '@/components/SlotPicker'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { StatusBadge } from './status'

export default function BookingPage() {
  const { token = '' } = useParams()
  const { tenant } = useCatalog()
  const cfg = tenant.public_config
  const tz = tenant.timezone
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['booking', token], queryFn: () => getBooking(token), retry: 1 })
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [moving, setMoving] = useState(false)
  const [day, setDay] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)

  // Открыли по ссылке на другом устройстве — запоминаем в «Мои записи».
  useEffect(() => {
    if (q.data && q.data.tenant_slug === tenant.slug) rememberBooking(tenant.slug, { token, startsAt: q.data.starts_at, service: q.data.service_name })
  }, [q.data, tenant.slug, token])

  const cancel = useMutation({
    mutationFn: () => cancelBooking(token),
    onSuccess: (b) => { qc.setQueryData(['booking', token], b); qc.invalidateQueries({ queryKey: ['slots', tenant.slug] }); toast.success('Запись отменена') },
    onError: (e) => toast.error((e as ApiError).message),
  })
  const move = useMutation({
    mutationFn: () => rescheduleBooking(token, slot!.starts_at, null),
    onSuccess: (b) => {
      qc.setQueryData(['booking', token], b)
      qc.invalidateQueries({ queryKey: ['slots', tenant.slug] })
      setMoving(false); setSlot(null); setDay(null)
      toast.success('Запись перенесена')
    },
    onError: (e) => {
      const err = e as ApiError
      toast.error(err.message)
      if (err.code === 'SLOT_TAKEN') { setSlot(null); qc.invalidateQueries({ queryKey: ['slots', tenant.slug] }) }
    },
  })

  return (
    <main className="mx-auto max-w-[520px] px-5 pb-28 pt-[max(env(safe-area-inset-top),12px)]">
      <Link to={`/s/${tenant.slug}/my`} className="press -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-secondary hover:text-primary">
        <ArrowLeft className="size-4" /> Мои записи
      </Link>

      {q.isPending ? (
        <div className="mt-6"><ListSkeleton rows={3} height={90} /></div>
      ) : q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : q.data.tenant_slug !== tenant.slug ? (
        <ErrorState message="Эта запись относится к другой студии." />
      ) : (
        <div className="mt-4 flex flex-col gap-5 fade-in">
          <div className="flex flex-col gap-2">
            <StatusBadge status={q.data.status} />
            <h1 className="font-display text-[26px] leading-tight font-semibold first-letter:uppercase">{longDateTime(q.data.starts_at, tz)}</h1>
            {q.data.is_demo && <p className="text-xs text-secondary">Демо-запись: студия работает в тестовом режиме.</p>}
          </div>

          <dl className="flex flex-col divide-y divide-white/6 rounded-[22px] border border-hairline bg-elevated">
            <Row icon={<Clock className="size-5" />} label="Услуга" value={`${q.data.service_name} · ${q.data.variant_label}`} extra={`${duration(q.data.duration_min)} · ${priceLabel(q.data.price, q.data.price_is_from)}`} />
            {q.data.resource && <Row icon={<User className="size-5" />} label="Мастер" value={q.data.resource.name} />}
            {(q.data.pet_name || q.data.pet_breed) && <Row icon={<PawPrint className="size-5" />} label="Питомец" value={[q.data.pet_name, q.data.pet_breed].filter(Boolean).join(', ')} />}
            <Row icon={<MapPin className="size-5" />} label="Адрес" value={`${cfg.city}, ${cfg.address}`} extra={cfg.addressNote} />
          </dl>

          {q.data.status === 'confirmed' && (
            <div className="flex flex-col gap-2">
              <Button
                label="Добавить в календарь"
                variant="primary"
                size="lg"
                width="100%"
                icon={<CalendarPlus className="size-4" />}
                onClick={() => downloadIcs({ uid: `${q.data.id}@zapis`, title: `${tenant.name}: ${q.data.service_name}`, start: q.data.starts_at, end: q.data.ends_at, location: `${cfg.city}, ${cfg.address}`, url: location.href })}
              />
              {q.data.can_change ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button label="Перенести" size="lg" width="100%" onClick={() => setMoving(true)} />
                  <Button label="Отменить" size="lg" width="100%" variant="ghost" onClick={() => setConfirmCancel(true)} />
                </div>
              ) : (
                <p className="text-center text-sm text-secondary">До визита меньше 2 часов — для изменений позвоните: <a className="text-accent" href={`tel:${cfg.phone.replace(/[^\d+]/g, '')}`}>{cfg.phone}</a></p>
              )}
            </div>
          )}
        </div>
      )}

      <AlertDialog
        isOpen={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Отменить запись?"
        description="Время освободится для других клиентов."
        actionLabel="Отменить запись"
        cancelLabel="Не отменять"
        actionVariant="destructive"
        isActionLoading={cancel.isPending}
        onAction={() => cancel.mutate(undefined, { onSettled: () => setConfirmCancel(false) })}
      />

      <Drawer open={moving} onOpenChange={setMoving} repositionInputs={false}>
        <DrawerContent aria-describedby={undefined}>
          <div className="px-5 pb-2 pt-3 text-center"><DrawerTitle className="text-base">Новое время</DrawerTitle></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {q.data && moving && (
              <SlotPicker slug={tenant.slug} tz={tz} variantId={q.data.variant_id} resourceId={null} days={Math.min(tenant.horizon_days, 21)} day={day} onDay={(d) => { setDay(d); setSlot(null) }} value={slot} onChange={setSlot} />
            )}
          </div>
          <footer className="border-t border-hairline px-5 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
            <Button label="Перенести сюда" variant="primary" size="lg" width="100%" isDisabled={!slot} isLoading={move.isPending} onClick={() => move.mutate()} />
          </footer>
        </DrawerContent>
      </Drawer>
    </main>
  )
}

function Row({ icon, label, value, extra }: { icon: React.ReactNode; label: string; value: string; extra?: string | null }) {
  return (
    <div className="flex gap-3 p-4">
      <span className="mt-0.5 text-accent">{icon}</span>
      <div className="flex flex-col">
        <dt className="text-xs font-semibold uppercase tracking-wider text-secondary">{label}</dt>
        <dd className="font-semibold">{value}</dd>
        {extra && <dd className="text-sm text-secondary">{extra}</dd>}
      </div>
    </div>
  )
}
