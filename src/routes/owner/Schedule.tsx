import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@astryxdesign/core/Button'
import { Ban, CalendarOff, Trash2 } from 'lucide-react'
import { ownerAgenda, ownerBlock, ownerClearDay, ownerSetDay, ownerUnblock, type ApiError } from '@/lib/api'
import { useCatalog } from '@/lib/tenant'
import { addDays, dayKey, dayLabel, timeLabel, zonedToUtc, hhmm } from '@/lib/time'
import { weeklySummary } from '@/lib/hours'
import { Field } from '@/components/ui/input'
import { ListSkeleton, ErrorState } from '@/components/states'
import { useOwner } from './OwnerRoot'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'

export default function Schedule() {
  const c = useCatalog()
  const { tenant, resources } = c
  const tz = tenant.timezone
  const { tenantId } = useOwner()
  const qc = useQueryClient()
  const today = dayKey(new Date(), tz)

  const blocks = useQuery({
    queryKey: ['owner', 'blocks', tenantId, today],
    queryFn: () => ownerAgenda(tenantId, zonedToUtc(today, '00:00', tz), zonedToUtc(addDays(today, 30), '00:00', tz)),
  })
  const exceptions = useQuery({
    queryKey: ['owner', 'exceptions', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from('schedule_exceptions').select('day, is_closed, opens_at, closes_at').eq('tenant_id', tenantId).gte('day', today).order('day')
      if (error) throw error
      return data as { day: string; is_closed: boolean; opens_at: string | null; closes_at: string | null }[]
    },
  })

  const [bDay, setBDay] = useState(today)
  const [bFrom, setBFrom] = useState('13:00')
  const [bTo, setBTo] = useState('14:00')
  const [bRes, setBRes] = useState<string | null>(null)
  const [bNote, setBNote] = useState('')
  const [xDay, setXDay] = useState(addDays(today, 1))
  const [xMode, setXMode] = useState<'closed' | 'hours'>('closed')
  const [xFrom, setXFrom] = useState('10:00')
  const [xTo, setXTo] = useState('16:00')

  const refresh = () => { qc.invalidateQueries({ queryKey: ['owner'] }); qc.invalidateQueries({ queryKey: ['catalog', tenant.slug] }); qc.invalidateQueries({ queryKey: ['slots'] }); qc.invalidateQueries({ queryKey: ['available-days'] }) }
  const block = useMutation({
    mutationFn: () => ownerBlock(tenantId, bRes, zonedToUtc(bDay, bFrom, tz), zonedToUtc(bDay, bTo, tz), bNote),
    onSuccess: () => { refresh(); toast.success('Время закрыто'); setBNote('') },
    onError: (e) => toast.error((e as ApiError).message),
  })
  const unblock = useMutation({ mutationFn: ownerUnblock, onSuccess: () => { refresh(); toast.success('Время открыто') }, onError: (e) => toast.error((e as ApiError).message) })
  const setDay = useMutation({
    mutationFn: () => ownerSetDay(tenantId, xDay, xMode === 'closed', xMode === 'hours' ? xFrom : null, xMode === 'hours' ? xTo : null),
    onSuccess: () => { refresh(); toast.success(xMode === 'closed' ? 'Выходной добавлен' : 'Часы на день изменены') },
    onError: (e) => toast.error((e as ApiError).message),
  })
  const clearDay = useMutation({ mutationFn: (d: string) => ownerClearDay(tenantId, d), onSuccess: () => { refresh(); toast.success('Обычный график восстановлен') } })

  return (
    <main className="flex flex-col gap-8 px-5 pb-28 pt-[max(env(safe-area-inset-top),16px)]">
      <header>
        <h1 className="font-display text-2xl font-semibold">График</h1>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {weeklySummary(c).map((r) => (<div key={r.days} className="contents"><dt className="text-secondary">{r.days}</dt><dd className="tabular">{r.value}</dd></div>))}
        </dl>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="h-block">
        <h2 id="h-block" className="flex items-center gap-2 font-semibold"><Ban className="size-4 text-accent" />Закрыть время</h2>
        <p className="text-sm text-secondary">Перерыв, личные дела, мастер задерживается — клиенты не смогут записаться на это время.</p>
        <div className="flex flex-col gap-3 rounded-[20px] border border-hairline bg-elevated p-4">
          <Field label="Дата" type="date" value={bDay} min={today} onChange={(e) => setBDay(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="С" type="time" step={900} value={bFrom} onChange={(e) => setBFrom(e.target.value)} />
            <Field label="До" type="time" step={900} value={bTo} onChange={(e) => setBTo(e.target.value)} />
          </div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {[{ id: null as string | null, name: 'Все мастера' }, ...resources.filter((r) => r.is_active)].map((r) => (
              <button key={r.id ?? 'all'} type="button" aria-pressed={bRes === r.id} onClick={() => setBRes(r.id)}
                className={cn('press min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold cursor-pointer', bRes === r.id ? 'border-transparent bg-accent-muted text-accent' : 'border-hairline bg-elevated-2 text-secondary')}>{r.name}</button>
            ))}
          </div>
          <Field label="Комментарий" value={bNote} onChange={(e) => setBNote(e.target.value)} placeholder="Например: обед" maxLength={200} />
          <Button label="Закрыть время" variant="primary" width="100%" isDisabled={bTo <= bFrom} isLoading={block.isPending} onClick={() => block.mutate()} />
        </div>
        {blocks.isPending ? <ListSkeleton rows={2} height={56} /> : blocks.isError ? <ErrorState message={(blocks.error as Error).message} onRetry={() => blocks.refetch()} /> : (
          <ul className="flex flex-col gap-2">
            {blocks.data.blocks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-2xl border border-hairline bg-elevated px-4 py-2">
                <span className="flex-1 text-sm">
                  <span className="font-semibold first-letter:uppercase">{dayLabel(dayKey(new Date(b.starts_at), tz), tz)}</span>{' '}
                  <span className="tabular">{timeLabel(b.starts_at, tz)}–{timeLabel(b.ends_at, tz)}</span>
                  <span className="block text-secondary">{resources.find((r) => r.id === b.resource_id)?.name}{b.note ? ` · ${b.note}` : ''}</span>
                </span>
                <Button label="Открыть время" isIconOnly variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => unblock.mutate(b.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="h-days">
        <h2 id="h-days" className="flex items-center gap-2 font-semibold"><CalendarOff className="size-4 text-accent" />Выходные и особые дни</h2>
        <div className="flex flex-col gap-3 rounded-[20px] border border-hairline bg-elevated p-4">
          <Field label="Дата" type="date" value={xDay} min={today} onChange={(e) => setXDay(e.target.value)} />
          <div role="radiogroup" aria-label="Режим" className="grid grid-cols-2 gap-2">
            {([['closed', 'Выходной'], ['hours', 'Другие часы']] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={xMode === k} onClick={() => setXMode(k)}
                className={cn('press min-h-11 rounded-xl border text-sm font-semibold cursor-pointer', xMode === k ? 'border-transparent bg-accent-muted text-accent' : 'border-hairline bg-elevated-2')}>{l}</button>
            ))}
          </div>
          {xMode === 'hours' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Открытие" type="time" step={900} value={xFrom} onChange={(e) => setXFrom(e.target.value)} />
              <Field label="Закрытие" type="time" step={900} value={xTo} onChange={(e) => setXTo(e.target.value)} />
            </div>
          )}
          <Button label="Сохранить" variant="primary" width="100%" isLoading={setDay.isPending} isDisabled={xMode === 'hours' && xTo <= xFrom} onClick={() => setDay.mutate()} />
          <p className="text-xs text-secondary">Уже существующие записи на этот день не отменяются — свяжитесь с клиентами.</p>
        </div>
        <ul className="flex flex-col gap-2">
          {(exceptions.data ?? []).map((x) => (
            <li key={x.day} className="flex items-center gap-3 rounded-2xl border border-hairline bg-elevated px-4 py-2">
              <span className="flex-1 text-sm">
                <span className="font-semibold first-letter:uppercase">{dayLabel(x.day, tz, { weekday: 'short', day: 'numeric', month: 'long' })}</span>
                <span className="block text-secondary">{x.is_closed ? 'Выходной' : `${hhmm(x.opens_at ?? '')}–${hhmm(x.closes_at ?? '')}`}</span>
              </span>
              <Button label="Вернуть обычный график" isIconOnly variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => clearDay.mutate(x.day)} />
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
