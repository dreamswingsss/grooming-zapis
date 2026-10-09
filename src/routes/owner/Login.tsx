import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@astryxdesign/core/Button'
import { Field } from '@/components/ui/input'
import { ArrowLeft, LockKeyhole } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCatalog } from '@/lib/tenant'

// Публичной регистрации владельцев нет: аккаунт создаёт администратор (см. SETUP.md).
export default function Login() {
  const { tenant } = useCatalog()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError(null)
    if (!email.includes('@') || password.length < 6) { setError('Введите почту и пароль (от 6 символов).'); return }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(error.message.includes('Invalid login') ? 'Неверная почта или пароль.' : 'Не удалось войти. Проверьте интернет и повторите.')
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col px-6 pt-[max(env(safe-area-inset-top),12px)] pb-10">
      <Link to={`/s/${tenant.slug}`} className="press -ml-2 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-secondary hover:text-primary">
        <ArrowLeft className="size-4" /> На сайт студии
      </Link>
      <div className="mt-[12vh] flex flex-col gap-2">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-muted text-accent"><LockKeyhole className="size-6" /></span>
        <h1 className="mt-3 font-display text-2xl font-semibold">Кабинет студии</h1>
        <p className="text-secondary">{tenant.name}: записи, график и цены.</p>
      </div>
      <form className="mt-8 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit() }} noValidate>
        <Field label="Почта" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        <Field label="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <Button label="Войти" type="submit" variant="primary" size="lg" width="100%" isLoading={busy} />
      </form>
    </main>
  )
}
