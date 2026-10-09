// shadcn/ui-поля. Высота 48px и шрифт 16px: удобно пальцем и без автозума iOS.
import * as React from 'react'
import { cn } from '@/lib/cn'

type Common = { label: string; hint?: string; error?: string; optional?: boolean; required?: boolean }

const control = (error?: string) =>
  cn(
    'block w-full min-w-0 max-w-full appearance-none rounded-2xl border border-hairline bg-elevated px-4 text-left text-base text-primary outline-none',
    'placeholder:text-secondary/60 focus:border-accent-bg focus:bg-elevated-2 transition-colors',
    error && 'border-error',
  )

function Shell({ id, label, hint, error, optional, required, children }: Common & { id: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-secondary">
        {label}
        {required && <span aria-hidden className="text-accent"> *</span>}
        {optional && <span className="font-normal opacity-70"> · необязательно</span>}
      </label>
      {children}
      {error ? (
        <span id={`${id}-err`} role="alert" className="text-sm text-error">{error}</span>
      ) : hint ? (
        <span id={`${id}-hint`} className="text-xs text-secondary">{hint}</span>
      ) : null}
    </div>
  )
}

export function Field({ label, hint, error, optional, required, className, id, ...props }: Common & React.ComponentProps<'input'>) {
  const autoId = React.useId()
  const inputId = id ?? autoId
  return (
    <Shell id={inputId} label={label} hint={hint} error={error} optional={optional} required={required}>
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined}
        className={cn(control(error), 'h-12', className)}
        {...props}
      />
    </Shell>
  )
}

export function AreaField({ label, hint, error, optional, required, className, id, ...props }: Common & React.ComponentProps<'textarea'>) {
  const autoId = React.useId()
  const inputId = id ?? autoId
  return (
    <Shell id={inputId} label={label} hint={hint} error={error} optional={optional} required={required}>
      <textarea
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(control(error), 'min-h-[88px] resize-none py-3 leading-relaxed', className)}
        {...props}
      />
    </Shell>
  )
}
