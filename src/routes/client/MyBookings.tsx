import { useQueries } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button } from '@astryxdesign/core/Button'
import { CalendarDays, ChevronRight } from 'lucide-react'
import { useCatalog } from '@/lib/tenant'
import { getBooking } from '@/lib/api'
import { savedBookings } from '@/lib/storage'
import { longDateTime } from '@/lib/time'
import { Empty, ListSkeleton } from '@/components/states'
import { useBooking } from './BookingFlow'
import { StatusBadge } from './status'

export default function MyBookings() {
  const { tenant } = useCatalog()
  const { open } = useBooking()
  const saved = savedBookings(tenant.slug)
  const results = useQueries({
    queries: saved.map((s) => ({ queryKey: ['booking', s.token], queryFn: () => getBooking(s.token), staleTime: 30_000 })),
  })
  const loading = results.some((r) => r.isPending)
  const items = results
    .map((r, i) => ({ saved: saved[i], data: r.data, error: r.error }))
    .sort((a, b) => (a.data?.starts_at ?? a.saved.startsAt).localeCompare(b.data?.starts_at ?? b.saved.startsAt))
  const now = new Date().toISOString()
  const upcoming = items.filter((x) => (x.data?.starts_at ?? x.saved.startsAt) >= now && x.data?.status !== 'cancelled')
  const past = items.filter((x) => !upcoming.includes(x))

  return (
    <main className="mx-auto max-w-[520px] px-5 pb-28 pt-[max(env(safe-area-inset-top),20px)]">
      <h1 className="font-display text-2xl font-semibold">Мои записи</h1>
      <p className="mt-1 text-sm text-secondary">Хранятся на этом устройстве. Ссылка из подтверждения откроет запись где угодно.</p>

      <div className="mt-6 flex flex-col gap-6">
        {!saved.length ? (
          <Empty
            icon={<CalendarDays className="size-10 text-secondary" strokeWidth={1.5} />}
            title="Записей пока нет"
            description="Выберите услугу и удобное время — это займёт меньше минуты."
            action={<Button label="Записаться" variant="primary" onClick={() => open()} />}
          />
        ) : loading ? (
          <ListSkeleton rows={Math.min(saved.length, 3)} />
        ) : (
          <>
            {[{ t: 'Предстоящие', list: upcoming }, { t: 'Прошедшие и отменённые', list: past }].map(({ t, list }) =>
              list.length ? (
                <section key={t} className="flex flex-col gap-3">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-secondary">{t}</h2>
                  {list.map(({ saved: s, data }) => (
                    <Link
                      key={s.token}
                      to={`../b/${s.token}`}
                      relative="path"
                      className="press flex items-center gap-3 rounded-[20px] border border-hairline bg-elevated p-4 hover:bg-elevated-2"
                    >
                      <span className="flex flex-1 flex-col gap-1">
                        <span className="font-semibold first-letter:uppercase">{longDateTime(data?.starts_at ?? s.startsAt, tenant.timezone)}</span>
                        <span className="text-sm text-secondary">{data ? `${data.service_name} · ${data.variant_label}` : s.service}</span>
                        {data && <StatusBadge status={data.status} />}
                        {!data && <span className="text-xs text-secondary">Не удалось обновить статус</span>}
                      </span>
                      <ChevronRight className="size-4 text-secondary" />
                    </Link>
                  ))}
                </section>
              ) : null,
            )}
          </>
        )}
      </div>
    </main>
  )
}
