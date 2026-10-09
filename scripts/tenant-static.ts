// После `vite build`: для каждой студии генерирует оболочку и PWA-ассеты в dist/s/{slug}/
//   index.html (свои title/description/og/theme-color/manifest/icons), manifest.webmanifest,
//   owner/index.html + owner/manifest.webmanifest, иконки, maskable, apple-touch, стартовые экраны,
//   sw.js (общий исходник, своя область), media/ (локальные фото).
// Общий JS/CSS остаётся один — в dist/assets.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { listTenants, loadTenant, localImages, root, tenantDir } from './lib'
import type { BusinessConfig } from '../src/lib/business-schema'

const dist = path.join(root, 'dist')
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('✗ нет dist/index.html — сначала vite build')
  process.exit(1)
}
const shell = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const sw = path.join(dist, 'sw.js')
const BG = '#0C0B0A'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function iconSvg(c: BusinessConfig, size: number, maskable: boolean) {
  const text = (c.public.logoText ?? c.name).replace(/[«»"]/g, '').trim()
  const letter = [...text][0]?.toUpperCase() ?? '•'
  const pad = maskable ? size * 0.2 : 0
  const r = maskable ? 0 : size * 0.22
  const inner = size - pad * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${BG}"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${inner * 0.36}" fill="${c.public.accent}"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700"
        font-size="${inner * 0.38}" fill="${BG}">${esc(letter)}</text>
</svg>`
}

function splashSvg(c: BusinessConfig, w: number, h: number) {
  const s = Math.min(w, h)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <circle cx="${w / 2}" cy="${h / 2 - s * 0.06}" r="${s * 0.12}" fill="${c.public.accent}"/>
  <text x="50%" y="${h / 2 + s * 0.16}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${s * 0.06}" fill="#F4EFEA">${esc((c.public.logoText ?? c.name).slice(0, 18))}</text>
</svg>`
}

// Популярные размеры iPhone (portrait, px) для apple-touch-startup-image.
const splashes: [number, number, number, number, number][] = [
  [1179, 2556, 393, 852, 3], [1290, 2796, 430, 932, 3], [1170, 2532, 390, 844, 3],
  [1284, 2778, 428, 926, 3], [1125, 2436, 375, 812, 3], [828, 1792, 414, 896, 2], [750, 1334, 375, 667, 2],
]

async function png(svg: string, file: string) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file)
}

let count = 0
for (const slug of listTenants()) {
  const { config: c, errors } = loadTenant(slug)
  if (errors.length) {
    console.error(`✗ ${slug} пропущен: ${errors.join('; ')}`)
    process.exitCode = 1
    continue
  }
  const out = path.join(dist, 's', slug)
  const base = `/s/${slug}/`
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true })
  fs.mkdirSync(path.join(out, 'owner'), { recursive: true })

  await png(iconSvg(c, 192, false), path.join(out, 'icons', 'icon-192.png'))
  await png(iconSvg(c, 512, false), path.join(out, 'icons', 'icon-512.png'))
  await png(iconSvg(c, 512, true), path.join(out, 'icons', 'maskable-512.png'))
  await png(iconSvg(c, 180, true), path.join(out, 'icons', 'apple-touch-icon.png'))
  fs.writeFileSync(path.join(out, 'icons', 'favicon.svg'), iconSvg(c, 64, false))
  for (const [w, h] of splashes) await png(splashSvg(c, w, h), path.join(out, 'icons', `splash-${w}x${h}.png`))

  const manifest = (owner: boolean) => ({
    id: owner ? `${base}owner/` : base,
    name: owner ? `${c.name} — кабинет` : c.name,
    short_name: (owner ? 'Кабинет' : c.public.logoText ?? c.name).slice(0, 12),
    description: c.public.tagline,
    lang: 'ru',
    start_url: owner ? `${base}owner/` : base,
    scope: base,
    display: 'standalone',
    orientation: 'portrait',
    background_color: BG,
    theme_color: BG,
    icons: [
      { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  })
  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify(manifest(false), null, 2))
  fs.writeFileSync(path.join(out, 'owner', 'manifest.webmanifest'), JSON.stringify(manifest(true), null, 2))

  const ogImage = /^https?:/.test(c.public.heroImage) ? c.public.heroImage + (c.public.heroImage.includes('unsplash') ? '?w=1200&h=630&fit=crop&q=75' : '') : `${base}media/${c.public.heroImage}`
  const head = (owner: boolean) => [
    `<link rel="manifest" href="${base}${owner ? 'owner/' : ''}manifest.webmanifest" />`,
    `<link rel="icon" type="image/svg+xml" href="${base}icons/favicon.svg" />`,
    `<link rel="apple-touch-icon" href="${base}icons/apple-touch-icon.png" />`,
    `<meta name="apple-mobile-web-app-title" content="${esc(owner ? 'Кабинет' : (c.public.logoText ?? c.name))}" />`,
    `<meta name="description" content="${esc(c.public.tagline)}" />`,
    `<meta property="og:title" content="${esc(c.name)}" />`,
    `<meta property="og:description" content="${esc(c.public.tagline)}" />`,
    `<meta property="og:image" content="${esc(ogImage)}" />`,
    `<meta property="og:type" content="website" />`,
    ...splashes.map(([w, h, dw, dh, r]) => `<link rel="apple-touch-startup-image" media="(device-width: ${dw}px) and (device-height: ${dh}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)" href="${base}icons/splash-${w}x${h}.png" />`),
  ].join('\n    ')
  const html = (owner: boolean) => shell
    .replace('<!--TENANT_HEAD-->', head(owner))
    .replace(/<title>.*?<\/title>/, `<title>${esc(owner ? `Кабинет · ${c.name}` : c.name)}</title>`)
  fs.writeFileSync(path.join(out, 'index.html'), html(false))
  fs.writeFileSync(path.join(out, 'owner', 'index.html'), html(true))

  if (fs.existsSync(sw)) fs.copyFileSync(sw, path.join(out, 'sw.js'))

  const imgs = localImages(c)
  if (imgs.length) {
    fs.mkdirSync(path.join(out, 'media'), { recursive: true })
    for (const f of imgs) fs.copyFileSync(path.join(tenantDir(slug), 'media', f), path.join(out, 'media', f))
  }
  count++
  console.log(`✓ dist/s/${slug}/ — оболочка, манифесты, ${4 + splashes.length} иконок/экранов${imgs.length ? `, фото: ${imgs.length}` : ''}`)
}
console.log(`Готово: студий ${count}`)
