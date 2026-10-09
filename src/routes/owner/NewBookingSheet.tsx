import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@astryxdesign/core/Button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Field } from '@/components/ui/input'
import { SlotPicker } from '@/components/SlotPicker'
import { ownerCreateBooking, type ApiError, type Slot } from '@/lib/api'
import { useCatalog } from '@/lib/tenant'
import { formatPhone, phoneDigits } from '@/lib/ics'
import { priceLabel } from '@/lib/time'
import { useOwner } from './OwnerRoot'
import { cn } from '@/lib/cn'

/** Запись клиента по звонку. Цена и длительность берутся из каталога на сервере. */
export function NewBookingSheet({ open, onOpenChange, defaultDay }: { open: boolean; onOpenChange: (o: boolean) => void; defaultDay: string }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent aria-describedby={undefined}>
        <div className="px-5 pt-3 pb-2 text-center"><DrawerTitle className="text-base">Записать клиента</DrawerTitle></div>
        {open && <Form defaultDay={defaultDay} onDone={() => onOpenChange(false)} />}
      </DrawerContent>
    </Drawer>
  )
}

function Form({ defaultDay, onDone }: { defaultDay: string; onDone: () => void }) {
  const { tenant, services, resources } = useCatalog()
  const { tenantId } = useOwner()
  const qc = useQueryClient()
  const active = services.filter((s) => s.is_active)
  const [serviceId, setServiceId] = useState(active[0]?.id ?? '')
  const service = active.find((s) => s.id === serviceId)
  const variants = service?.variants.filter((v) => v.is_active) ?? []
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '')
  const eligible = service?.resourceIds.length ? resources.filter((r) => r.is_active && service.resourceIds.includes(r.id)) : resources.filter((r) => r.is_active)
  const [resourceId, setResourceId] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(defaultDay)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [petName, setPetName] = useState('')
  const [petBreed, setPetBreed] = useState('')

  const create = useMutation({
    mutationFn: () => ownerCreateBooking({
      tenantId, variantId, resourceId: resourceId ?? slot!.resource_ids[0], startsAt: slot!.starts_at,
      name, phone: phoneDigits(phone), petName, petBreed, comment: '',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['owner'] }); qc.invalidateQueries({ queryKey: ['slots'] }); toast.success('Клиент записан'); onDone() },
    onError: (e) => toast.error((e as ApiError).message),
  })

  const valid = Boolean(variantId && slot && name.trim() && phoneDigits(phone).length === 11)

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-secondary">Услуга</span>
            <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); const s = active.find((x) => x.id === e.target.value); setVariantId(s?.variants.find((v) => v.is_active)?.id ?? ''); setSlot(null) }}
              className="h-12 rounded-2xl border border-hairline bg-elevated px-4 text-base text-primary">
              {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {variants.length > 1 && (
            <div role="radiogroup" aria-label="Вариант" className="grid grid-cols-2 gap-2">
              {variants.map((v) => (
                <button key={v.id} type="button" role="radio" aria-checked={v.id === variantId} onClick={() => { setVariantId(v.id); setSlot(null) }}
                  className={cn('press flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 text-left cursor-pointer', v.id === variantId ? 'border-transparent bg-accent-muted' : 'border-hairline bg-elevated')}>
                  <span className="text-sm font-semibold">{v.label}</span>
                  <span className="text-xs text-secondary tabular">{priceLabel(v.price, v.price_is_from)}</span>
                </button>
              ))}
            </div>
          )}
          {eligible.length > 1 && (
            <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
              {[{ id: null as string | null, name: 'Любой' }, ...eligible].map((r) => (
                <button key={r.id ?? 'any'} type="button" aria-pressed={resourceId === r.id} onClick={() => { setResourceId(r.id); setSlot(null) }}
                  className={cn('press min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold cursor-pointer', resourceId === r.id ? 'border-transparent bg-accent-muted text-accent' : 'border-hairline bg-elevated text-secondary')}>
                  {r.name}
                </button>
              ))}
            </div>
          )}
          {variantId && (
            <SlotPicker slug={tenant.slug} tz={tenant.timezone} variantId={variantId} resourceId={resourceId} days={21} day={day} onDay={(d) => { setDay(d); setSlot(null) }} value={slot} onChange={setSlot} />
          )}
          <Field label="Имя клиента" required value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Телефон" required type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="+7 (___) ___-__-__" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Кличка" value={petName} onChange={(e) => setPetName(e.target.value)} />
            <Field label="Порода" value={petBreed} onChange={(e) => setPetBreed(e.target.value)} />
          </div>
        </div>
      </div>
      <footer className="border-t border-hairline px-5 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
        <Button label="Записать" variant="primary" size="lg" width="100%" isDisabled={!valid} isLoading={create.isPending} onClick={() => create.mutate()} />
      </footer>
    </>
  )
}
