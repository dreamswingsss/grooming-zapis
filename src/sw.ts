/// <reference lib="webworker" />
// Один исходник воркера для всех студий. Каждая студия регистрирует его в своей области
// /s/{slug}/, поэтому кэши разделены по slug. Данные Supabase (записи, кабинет) не кэшируются.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare const self: ServiceWorkerGlobalScope

const scope = new URL(self.registration.scope).pathname // /s/{slug}/
const slug = scope.split('/').filter(Boolean)[1] ?? 'root'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

cleanupOutdatedCaches()
// Общие ассеты сборки (JS/CSS/шрифты) — одинаковые для всех студий.
precacheAndRoute(self.__WB_MANIFEST, {})

// Оболочка студии: всегда пробуем сеть, офлайн — последняя сохранённая версия.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({ cacheName: `shell-${slug}`, networkTimeoutSeconds: 4 }),
    { allowlist: [new RegExp(`^${scope}`)] },
  ),
)

// Фото услуг и галереи.
registerRoute(
  ({ request, url }) => request.destination === 'image' && (url.pathname.startsWith(scope) || url.hostname === 'images.unsplash.com'),
  new CacheFirst({ cacheName: `img-${slug}`, plugins: [new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 30 * 86400 })] }),
)
