import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { ownerStats } from '@/lib/api'
import { useCatalog } from '@/lib/tenant'
import { addDays, dayKey, dayLabel, money } from '@/lib/time'
import { ErrorState, ListSkeleton } from '@/components/states'
import { useOwner } from './OwnerRoot'

const periods = { week: 7, month: 30, quarter: 90 } as const

export default function Stats() {
  const { tenant } = useCatalog()
  const { tenantId } = useOwner()
  const tz = tenant.timezone
  const [p, setP] = useState<keyof typeof periods>('month')
  const to = dayKey(new Date(), tz)
  const from = addDays(to, -(periods[p] - 1))
  const q = useQuery({ queryKey: ['owner', 'stats', tenantId, from, to], queryFn: () => ownerStats(tenantId, from, to) })
  const max = Math.max(1, ...(q.data?.by_day.map((d) => d.bookings) ?? [1]))

  return (
    <main className="flex flex-col gap-5 px-5 pb-28 pt-[max(env(safe-area-inset-top),16px)]">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-2xl font-semibold">Статистика</h1>
        <SegmentedControl label="Период" value={p} onChange={(v) => setP(v as keyof typeof periods)} layout="fill">
          <SegmentedControlItem value="week" label="7 дней" />
          <SegmentedControlItem value="month" label="30 дней" />
          <SegmentedControlItem value="quarter" label="90 дней" />
        </SegmentedControl>
        <p className="text-xs text-secondary">
          {dayLabel(from, tz, { day: 'numeric', month: 'long' })} — {dayLabel(to, tz, { day: 'numeric', month: 'long' })}, время студии ({tz}).
        </p>
      </header>

      {q.isPending ? <ListSkeleton rows={4} height={80} /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Получено оплат" value={money(q.data.paid_total)} note="фактические платежи за период" accent />
            <Tile label="Выполнено услуг" value={String(q.data.completed)} note={`на ${money(q.data.completed_value)} по прайсу`} />
            <Tile label="Визиты" value={String(q.data.visits)} note="клиент пришёл" />
            <Tile label="Записей" value={String(q.data.bookings_total)} note={`отмен: ${q.data.cancelled} · не пришли: ${q.data.no_show}`} />
          </div>
          <div className="rounded-[20px] border border-dashed border-hairline p-4 text-sm">
            <span className="text-secondary">Будущие подтверждённые записи на сумму </span>
            <span className="font-bold tabular">{money(q.data.expected_value)}</span>
            <span className="text-secondary"> — это ожидание, а не выручка.</span>
          </div>

          <section className="flex flex-col gap-3 rounded-[20px] border border-hairline bg-elevated p-4" aria-labelledby="h-days">
            <h2 id="h-days" className="font-semibold">Записи по дням</h2>
            {q.data.by_day.length ? (
              <>
                <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={`Записи по дням: максимум ${max} в день`}>
                  {Array.from({ length: periods[p] }, (_, i) => {
                    const d = addDays(from, i)
                    const v = q.data.by_day.find((x) => x.day === d)?.bookings ?? 0
                    return <span key={d} title={`${dayLabel(d, tz)}: ${v}`} className="flex-1 rounded-t-[3px] bg-accent-bg/85 min-h-[2px]" style={{ height: `${(v / max) * 100}%`, opacity: v ? 1 : 0.18 }} />
                  })}
                </div>
                <div className="flex justify-between text-[11px] text-secondary"><span>{dayLabel(from, tz, { day: 'numeric', month: 'short' })}</span><span>{dayLabel(to, tz, { day: 'numeric', month: 'short' })}</span></div>
              </>
            ) : <p className="text-sm text-secondary">За период записей нет.</p>}
          </section>

          {q.data.by_service.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="h-svc">
              <h2 id="h-svc" className="font-semibold">Популярные услуги</h2>
              <table className="w-full text-sm">
                <thead className="sr-only"><tr><th>Услуга</th><th>Записей</th><th>Выполнено на сумму</th></tr></thead>
                <tbody>
                  {q.data.by_service.map((s) => (
                    <tr key={s.name} className="border-b border-hairline">
                      <td className="py-2.5 pr-2">{s.name}</td>
                      <td className="py-2.5 text-right tabular">{s.cnt}</td>
                      <td className="py-2.5 pl-3 text-right text-secondary tabular">{money(s.done_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </main>
  )
}

function Tile({ label, value, note, accent }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-[20px] border p-4 ${accent ? 'border-transparent bg-accent-muted' : 'border-hairline bg-elevated'}`}>
      <span className="text-xs font-semibold text-secondary">{label}</span>
      <span className={`text-2xl font-bold tabular ${accent ? 'text-accent' : ''}`}>{value}</span>
      <span className="text-[11px] leading-snug text-secondary">{note}</span>
    </div>
  )
}
