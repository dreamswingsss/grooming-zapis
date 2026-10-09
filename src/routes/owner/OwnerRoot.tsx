import { createContext, useContext, useEffect, useState } from 'react'
import { Outlet, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { Button } from '@astryxdesign/core/Button'
import { BarChart3, CalendarClock, ListChecks, Tags } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ownerMyTenants } from '@/lib/api'
import { useCatalog } from '@/lib/tenant'
import { BottomNav } from '@/components/BottomNav'
import { AppSkeleton, ErrorState } from '@/components/states'
import Login from './Login'

type OwnerCtx = { tenantId: string; signOut: () => Promise<void>; email: string }
const Ctx = createContext<OwnerCtx | null>(null)
export const useOwner = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useOwner вне OwnerRoot')
  return c
}

export default function OwnerRoot() {
  const { slug = '' } = useParams()
  const { tenant } = useCatalog()
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const memberships = useQuery({
    queryKey: ['owner', 'tenants', session?.user.id],
    queryFn: ownerMyTenants,
    enabled: Boolean(session),
  })

  useEffect(() => { document.title = `Кабинет · ${tenant.name}` }, [tenant.name])

  // Выход: завершаем сессию и удаляем из памяти все приватные данные кабинета.
  const signOut = async () => {
    await supabase.auth.signOut()
    qc.removeQueries({ queryKey: ['owner'] })
  }

  if (session === undefined) return <AppSkeleton />
  if (!session) return <Login />
  if (memberships.isPending) return <AppSkeleton />
  if (memberships.isError) return <ErrorState message={(memberships.error as Error).message} onRetry={() => memberships.refetch()} />

  const member = memberships.data.find((m) => m.slug === slug)
  if (!member) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[520px] flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-display text-xl font-semibold">Нет доступа к «{tenant.name}»</h1>
        <p className="text-secondary">Аккаунт {session.user.email} не привязан к этой студии.</p>
        <Button label="Выйти" onClick={signOut} />
      </main>
    )
  }

  return (
    <Ctx.Provider value={{ tenantId: member.id, signOut, email: session.user.email ?? '' }}>
      <div className="mx-auto min-h-dvh max-w-[560px]">
        <Outlet />
        <BottomNav
          items={[
            { to: `/s/${slug}/owner`, label: 'Записи', icon: ListChecks, end: true },
            { to: `/s/${slug}/owner/schedule`, label: 'График', icon: CalendarClock },
            { to: `/s/${slug}/owner/prices`, label: 'Цены', icon: Tags },
            { to: `/s/${slug}/owner/stats`, label: 'Статистика', icon: BarChart3 },
          ]}
        />
      </div>
    </Ctx.Provider>
  )
}
