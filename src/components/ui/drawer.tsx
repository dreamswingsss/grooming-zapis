// shadcn/ui Drawer — ветка на vaul (единственная используемая в проекте; Base UI не подключаем).
import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { cn } from '@/lib/cn'

function Drawer({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}
const DrawerTrigger = DrawerPrimitive.Trigger
const DrawerPortal = DrawerPrimitive.Portal
const DrawerClose = DrawerPrimitive.Close

function DrawerOverlay({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn('fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_200ms_ease-out]', className)}
      {...props}
    />
  )
}

function DrawerContent({ className, children, ...props }: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-[520px] flex-col',
          'rounded-t-[28px] border border-b-0 border-hairline bg-surface outline-none',
          className,
        )}
        {...props}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-white/15" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return <DrawerPrimitive.Title className={cn('text-lg font-bold text-primary', className)} {...props} />
}
function DrawerDescription({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return <DrawerPrimitive.Description className={cn('text-sm text-secondary', className)} {...props} />
}

export { Drawer, DrawerTrigger, DrawerClose, DrawerContent, DrawerTitle, DrawerDescription }
