import { NavLink } from 'react-router'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number }

export function BottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-[color-mix(in_oklab,var(--color-background-body)_82%,transparent)] backdrop-blur-xl pb-safe"
    >
      <ul className="mx-auto grid max-w-[520px]" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(({ to, label, icon: Icon, end, badge }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'press relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold',
                  isActive ? 'text-accent' : 'text-secondary hover:text-primary',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('relative flex h-8 w-14 items-center justify-center rounded-full transition-colors', isActive && 'bg-accent-muted')}>
                    <Icon className="size-[22px]" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
                    {badge ? (
                      <span className="absolute -top-0.5 right-2 min-w-4 rounded-full bg-accent-bg px-1 text-center text-[10px] leading-4 text-on-accent tabular">
                        {badge}
                      </span>
                    ) : null}
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
