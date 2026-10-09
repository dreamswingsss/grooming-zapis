import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Theme } from '@astryxdesign/core/theme'
import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import { fetchCatalog, type Catalog } from './api'

const Ctx = createContext<Catalog | null>(null)

export function useCatalog() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useCatalog вне TenantProvider')
  return c
}

export const catalogQuery = (slug: string) => ({
  queryKey: ['catalog', slug],
  queryFn: () => fetchCatalog(slug),
  staleTime: 60_000,
})

export function useCatalogQuery(slug: string) {
  return useQuery(catalogQuery(slug))
}

/** Тема Astryx из акцента студии: тёмная, один акцент, тёплые нейтрали. */
function useTenantTheme(accent: string | undefined) {
  return useMemo(
    () =>
      defineTheme({
        name: 'tenant',
        extends: neutralTheme,
        color: { accent: accent ?? '#E9A46A', neutralStyle: 'warm' },
        radius: { base: 6, multiplier: 1.6 },
        typography: {
          scale: { base: 16, ratio: 1.2 },
          body: { family: 'Manrope', fallbacks: 'system-ui, -apple-system, sans-serif' },
          heading: { family: 'Manrope', fallbacks: 'system-ui, -apple-system, sans-serif' },
        },
        tokens: {
          // Мобильные цели касания: не меньше 44px.
          '--size-element-sm': '36px',
          '--size-element-md': '44px',
          '--size-element-lg': '52px',
          '--color-background-body': ['#FAF8F5', '#0C0B0A'],
          '--color-background-surface': ['#FFFFFF', '#141311'],
          '--color-background-card': ['#FFFFFF', '#171614'],
          '--color-background-popover': ['#FFFFFF', '#1A1917'],
        },
      }),
    [accent],
  )
}

export function TenantTheme({ accent, children }: { accent?: string; children: ReactNode }) {
  const theme = useTenantTheme(accent)
  return (
    <Theme theme={theme} mode="dark">
      {children}
    </Theme>
  )
}

export function TenantProvider({ catalog, children }: { catalog: Catalog; children: ReactNode }) {
  return (
    <Ctx.Provider value={catalog}>
      <TenantTheme accent={catalog.tenant.public_config.accent}>{children}</TenantTheme>
    </Ctx.Provider>
  )
}

/** Фото: абсолютный URL, путь от корня или файл из папки студии (/s/{slug}/media/). */
export function mediaUrl(slug: string, src: string | null | undefined, width = 1200) {
  if (!src) return undefined
  let url = /^(https?:)?\/\//.test(src) || src.startsWith('/') ? src : `/s/${slug}/media/${src}`
  if (url.includes('images.unsplash.com')) {
    const u = new URL(url)
    u.searchParams.set('w', String(width))
    u.searchParams.set('q', '72')
    u.searchParams.set('auto', 'format')
    u.searchParams.set('fit', 'crop')
    url = u.toString()
  }
  return url
}
