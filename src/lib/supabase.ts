import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

// Сессия владельца хранится в localStorage (так работает Supabase Auth); при выходе
// приложение вызывает signOut и очищает кэш запросов.
export const supabase = createClient(url ?? 'http://invalid.local', anonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'zapis-owner-auth' },
})
