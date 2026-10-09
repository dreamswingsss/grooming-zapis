import { Badge } from '@astryxdesign/core/Badge'

export const statusText = {
  confirmed: 'Подтверждена',
  arrived: 'Клиент пришёл',
  done: 'Выполнена',
  cancelled: 'Отменена',
  no_show: 'Не пришёл',
} as const

const variants = {
  confirmed: 'success',
  arrived: 'info',
  done: 'neutral',
  cancelled: 'error',
  no_show: 'warning',
} as const

export function StatusBadge({ status }: { status: keyof typeof statusText }) {
  return (
    <span className="w-fit">
      <Badge variant={variants[status]} label={statusText[status]} />
    </span>
  )
}
