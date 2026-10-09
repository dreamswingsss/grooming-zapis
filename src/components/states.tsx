import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Button } from '@astryxdesign/core/Button'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { CloudOff, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section role="alert" className="flex flex-col items-center px-6 py-14 text-center fade-in">
      <EmptyState
        icon={<CloudOff className="size-10 text-secondary" strokeWidth={1.5} />}
        title="Не получилось загрузить"
        description={message}
        actions={onRetry ? <Button label="Повторить" variant="primary" onClick={onRetry} /> : undefined}
      />
    </section>
  )
}

export function Empty({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <section className="flex flex-col items-center px-6 py-12 text-center fade-in">
      <EmptyState
        icon={icon ?? <Inbox className="size-10 text-secondary" strokeWidth={1.5} />}
        title={title}
        description={description}
        actions={action}
      />
    </section>
  )
}

export function ListSkeleton({ rows = 4, height = 76 }: { rows?: number; height?: number }) {
  return (
    <div aria-busy="true" aria-label="Загрузка" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={4} index={i} />
      ))}
    </div>
  )
}

export function AppSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка" className="mx-auto flex min-h-dvh max-w-[520px] flex-col gap-4">
      <Skeleton height={420} radius="none" />
      <div className="flex flex-col gap-3 px-5">
        <Skeleton height={28} width="60%" radius={2} index={1} />
        <Skeleton height={18} width="80%" radius={2} index={2} />
        <Skeleton height={56} radius={4} index={3} />
      </div>
    </div>
  )
}
