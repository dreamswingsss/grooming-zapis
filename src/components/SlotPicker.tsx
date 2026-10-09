import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Button } from '@astryxdesign/core/Button'
import { CalendarX2 } from 'lucide-react'
import { getAvailableDays, getSlots, type Slot } from '@/lib/api'
import { addDays, dayKey, dayLabel, timeLabel } from '@/lib/time'
import { cn } from '@/lib/cn'

type Props = {
  slug: string
  tz: string
  variantId: string
  resourceId: string | null
  days?: number
  day: string | null
  onDay: (d: string) => void
  value: Slot | null
  onChange: (s: Slot) => void
}

const groups = [
  { label: 'Утро', test: (h: number) => h < 12 },
  { label: 'День', test: (h: number) => h >= 12 && h < 17 },
  { label: 'Вечер', test: (h: number) => h >= 17 },
]

export function SlotPicker({ slug, tz, variantId, resourceId, days = 14, day, onDay, value, onChange }: Props) {
  const today = dayKey(new Date(), tz)
  const range = useMemo(() => Array.from({ length: days }, (_, i) => addDays(today, i)), [today, days])

  const daysQ = useQuery({
    queryKey: ['available-days', slug, variantId, range[0], range[range.length - 1]],
    queryFn: () => getAvailableDays(slug, variantId, range[0], range[range.length - 1]),
    staleTime: 30_000,
  })
  const slotsQ = useQuery({
    queryKey: ['slots', slug, variantId, day],
    queryFn: () => getSlots(slug, variantId, day!),
    enabled: Boolean(day),
    staleTime: 15_000,
  })

  // Сразу выбираем первый день, где есть окна.
  useEffect(() => {
    if (!day && daysQ.data?.length) onDay(daysQ.data[0])
  }, [day, daysQ.data, onDay])

  const available = new Set(daysQ.data ?? [])
  const slots = (slotsQ.data ?? []).filter((s) => !resourceId || s.resource_ids.includes(resourceId))

  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [day])

  return (
    <div className="flex flex-col gap-5">
      <div ref={stripRef} role="group" aria-label="Дата" className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {range.map((d) => {
          const isOn = d === day
          const has = available.has(d)
          const loading = daysQ.isPending
          return (
            <button
              key={d}
              type="button"
              aria-pressed={isOn}
              disabled={!loading && !has}
              onClick={() => onDay(d)}
              className={cn(
                'press flex h-[72px] w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border text-center cursor-pointer',
                isOn ? 'border-transparent bg-accent-bg text-on-accent' : 'border-hairline bg-elevated text-primary',
                !loading && !has && 'cursor-not-allowed opacity-35',
              )}
            >
              <span className={cn('text-[11px] font-semibold uppercase', isOn ? 'text-on-accent/80' : 'text-secondary')}>
                {d === today ? 'сег' : dayLabel(d, tz, { weekday: 'short' })}
              </span>
              <span className="text-xl font-bold tabular">{Number(d.slice(8))}</span>
              <span className={cn('size-1 rounded-full', has && !isOn ? 'bg-accent-bg' : 'bg-transparent')} />
            </button>
          )
        })}
      </div>

      {daysQ.isError ? (
        <ErrorLine message={(daysQ.error as Error).message} onRetry={() => daysQ.refetch()} />
      ) : daysQ.isSuccess && !daysQ.data.length ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-hairline bg-elevated px-5 py-8 text-center">
          <CalendarX2 className="size-8 text-secondary" strokeWidth={1.5} />
          <p className="font-semibold">Свободных окон на 2 недели нет</p>
          <p className="text-sm text-secondary">Позвоните в студию — подберём время вручную.</p>
        </div>
      ) : !day || slotsQ.isPending ? (
        <div className="flex h-40 items-center justify-center"><Spinner size="lg" /></div>
      ) : slotsQ.isError ? (
        <ErrorLine message={(slotsQ.error as Error).message} onRetry={() => slotsQ.refetch()} />
      ) : !slots.length ? (
        <p className="rounded-2xl border border-hairline bg-elevated px-5 py-6 text-center text-sm text-secondary">
          На {dayLabel(day, tz, { day: 'numeric', month: 'long' })} всё занято. Выберите другой день.
        </p>
      ) : (
        <div className="flex flex-col gap-4 fade-in" key={day}>
          {groups.map((g) => {
            const list = slots.filter((s) => g.test(Number(timeLabel(s.starts_at, tz).slice(0, 2))))
            if (!list.length) return null
            return (
              <fieldset key={g.label} className="flex flex-col gap-2">
                <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-secondary">{g.label}</legend>
                <div className="grid grid-cols-4 gap-2">
                  {list.map((s) => {
                    const on = value?.starts_at === s.starts_at
                    return (
                      <button
                        key={s.starts_at}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(s)}
                        className={cn(
                          'press h-11 rounded-xl border text-[15px] font-semibold tabular cursor-pointer',
                          on ? 'border-transparent bg-accent-bg text-on-accent' : 'border-hairline bg-elevated text-primary hover:bg-elevated-2',
                        )}
                      >
                        {timeLabel(s.starts_at, tz)}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-hairline bg-elevated px-4 py-3">
      <span className="text-sm text-secondary">{message}</span>
      <Button label="Повторить" size="sm" onClick={onRetry} />
    </div>
  )
}
