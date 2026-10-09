import { useEffect } from 'react'
import { Outlet, useLocation, useParams } from 'react-router'
import { Home, CalendarDays, Scissors, MapPin } from 'lucide-react'
import { useCatalogQuery, TenantProvider, TenantTheme } from '@/lib/tenant'
import { AppSkeleton, ErrorState } from '@/components/states'
import { BottomNav } from '@/components/BottomNav'
import { BookingProvider } from './client/BookingFlow'
import { savedBookings } from '@/lib/storage'

/** Регистрирует service worker в области конкретной студии: /s/{slug}/. */
function useTenantWorker(slug: string) {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
    navigator.serviceWorker.register(`/s/${slug}/sw.js`, { scope: `/s/${slug}/` }).catch(() => {})
  }, [slug])
}

export default function TenantRoot() {
  const { slug = '' } = useParams()
  const q = useCatalogQuery(slug)
  useTenantWorker(slug)

  useEffect(() => {
    if (q.data) document.title = q.data.tenant.name
  }, [q.data])

  if (q.isPending) return <TenantTheme><AppSkeleton /></TenantTheme>
  if (q.isError)
    return (
      <TenantTheme>
        <main className="mx-auto flex min-h-dvh max-w-[520px] items-center"><ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /></main>
      </TenantTheme>
    )

  return (
    <TenantProvider catalog={q.data}>
      <BookingProvider>
        <Outlet />
      </BookingProvider>
    </TenantProvider>
  )
}

/** Оболочка клиентской части с нижней навигацией. */
export function ClientShell() {
  const { slug = '' } = useParams()
  const loc = useLocation()
  useEffect(() => {
    document.getElementById('main-focus')?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [loc.pathname])
  const upcoming = savedBookings(slug).filter((b) => b.startsAt >= new Date().toISOString()).length
  return (
    <div className="mx-auto min-h-dvh max-w-[520px]">
      <span id="main-focus" tabIndex={-1} className="sr-only">Начало страницы</span>
      <Outlet />
      <BottomNav
        items={[
          { to: `/s/${slug}`, label: 'Главная', icon: Home, end: true },
          { to: `/s/${slug}/services`, label: 'Услуги', icon: Scissors },
          { to: `/s/${slug}/my`, label: 'Мои записи', icon: CalendarDays, badge: upcoming || undefined },
          { to: `/s/${slug}/contacts`, label: 'Контакты', icon: MapPin },
        ]}
      />
    </div>
  )
}
