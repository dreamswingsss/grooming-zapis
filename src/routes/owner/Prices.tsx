import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@astryxdesign/core/Button'
import { Switch } from '@astryxdesign/core/Switch'
import { ownerUpdateVariant, type ApiError, type Variant } from '@/lib/api'
import { useCatalog } from '@/lib/tenant'

export default function Prices() {
  const { tenant, services } = useCatalog()
  return (
    <main className="flex flex-col gap-6 px-5 pb-28 pt-[max(env(safe-area-inset-top),16px)]">
      <header>
        <h1 className="font-display text-2xl font-semibold">Цены и время</h1>
        <p className="mt-1 text-sm text-secondary">Меняются сразу на сайте. В уже созданных записях остаётся прежняя цена.</p>
      </header>
      {tenant.public_config.categories.map((c) => {
        const list = services.filter((s) => s.category === c.key)
        if (!list.length) return null
        return (
          <section key={c.key} className="flex flex-col gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-secondary">{c.label}</h2>
            {list.map((s) => (
              <article key={s.id} className="flex flex-col gap-2 rounded-[20px] border border-hairline bg-elevated p-4">
                <h3 className="font-semibold">{s.name}</h3>
                {s.variants.map((v) => <VariantEditor key={v.id} v={v} />)}
              </article>
            ))}
          </section>
        )
      })}
    </main>
  )
}

function VariantEditor({ v }: { v: Variant }) {
  const { tenant } = useCatalog()
  const qc = useQueryClient()
  const [price, setPrice] = useState(String(v.price))
  const [dur, setDur] = useState(String(v.duration_min))
  const [active, setActive] = useState(v.is_active)
  const dirty = Number(price) !== v.price || Number(dur) !== v.duration_min || active !== v.is_active
  const save = useMutation({
    mutationFn: () => ownerUpdateVariant(v.id, Number(price), Number(dur), active),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['catalog', tenant.slug] }); toast.success('Сохранено') },
    onError: (e) => toast.error((e as ApiError).message),
  })
  const valid = Number(price) >= 0 && Number(dur) >= 5 && Number(dur) <= 4320
  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{v.label}</span>
        <Switch label="Доступна для записи" isLabelHidden size="sm" value={active} onChange={setActive} />
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-secondary">Цена, ₽{v.price_is_from ? ' (от)' : ''}</span>
          <input inputMode="numeric" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className="h-11 rounded-xl border border-hairline bg-elevated-2 px-3 text-base tabular" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-secondary">Минут</span>
          <input inputMode="numeric" type="number" min={5} step={5} value={dur} onChange={(e) => setDur(e.target.value)} className="h-11 rounded-xl border border-hairline bg-elevated-2 px-3 text-base tabular" />
        </label>
        <Button label="Сохранить" size="md" variant={dirty ? 'primary' : 'secondary'} isDisabled={!dirty || !valid} isLoading={save.isPending} onClick={() => save.mutate()} />
      </div>
    </div>
  )
}
