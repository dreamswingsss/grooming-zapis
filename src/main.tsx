import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { InternationalizationProvider } from '@astryxdesign/core/i18n'
import ruRU from '@astryxdesign/core/locales/ru-RU.generated.js'
import './styles/globals.css'
import TenantRoot, { ClientShell } from './routes/TenantRoot'
import Home from './routes/client/Home'
import { AppSkeleton } from './components/states'
import { supabaseConfigured } from './lib/supabase'
import { TenantTheme } from './lib/tenant'
import { ErrorState } from './components/states'

const Services = lazy(() => import('./routes/client/Services'))
const MyBookings = lazy(() => import('./routes/client/MyBookings'))
const Contacts = lazy(() => import('./routes/client/Contacts'))
const BookingPage = lazy(() => import('./routes/client/BookingPage'))
const OwnerRoot = lazy(() => import('./routes/owner/OwnerRoot'))
const Agenda = lazy(() => import('./routes/owner/Agenda'))
const Schedule = lazy(() => import('./routes/owner/Schedule'))
const Prices = lazy(() => import('./routes/owner/Prices'))
const Stats = lazy(() => import('./routes/owner/Stats'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
})

const s = (el: React.ReactNode) => <Suspense fallback={<AppSkeleton />}>{el}</Suspense>

const router = createBrowserRouter([
  { path: '/', element: <RootNotice /> },
  {
    path: '/s/:slug',
    element: <TenantRoot />,
    children: [
      {
        element: <ClientShell />,
        children: [
          { index: true, element: <Home /> },
          { path: 'services', element: s(<Services />) },
          { path: 'my', element: s(<MyBookings />) },
          { path: 'contacts', element: s(<Contacts />) },
          { path: 'b/:token', element: s(<BookingPage />) },
        ],
      },
      {
        path: 'owner',
        element: s(<OwnerRoot />),
        children: [
          { index: true, element: s(<Agenda />) },
          { path: 'schedule', element: s(<Schedule />) },
          { path: 'prices', element: s(<Prices />) },
          { path: 'stats', element: s(<Stats />) },
        ],
      },
      { path: '*', element: <Navigate to="." replace /> },
    ],
  },
  { path: '*', element: <RootNotice /> },
])

function RootNotice() {
  return (
    <TenantTheme>
      <main className="mx-auto flex min-h-dvh max-w-[520px] items-center px-6">
        <ErrorState message={supabaseConfigured ? 'Откройте ссылку конкретной студии: /s/название-студии' : 'Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (см. SETUP.md).'} />
      </main>
    </TenantTheme>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <InternationalizationProvider locale="ru-RU" messages={{ 'ru-RU': ruRU }}>
        <RouterProvider router={router} />
      </InternationalizationProvider>
      <Toaster theme="dark" position="top-center" toastOptions={{ style: { borderRadius: 16, fontFamily: 'Manrope, sans-serif' } }} />
    </QueryClientProvider>
  </StrictMode>,
)
