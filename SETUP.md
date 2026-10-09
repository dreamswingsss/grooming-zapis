# Онлайн-запись для груминга — запуск

PWA онлайн-записи: одна сборка на все студии, у каждой своя ссылка `/s/{slug}/` и кабинет `/s/{slug}/owner/`.
Стек: React 19 + TypeScript strict + Vite + React Router + TanStack Query + Zod + shadcn/ui (vaul Drawer) + Astryx, Supabase (Postgres/Auth), vite-plugin-pwa (injectManifest).

## 1. База Supabase (один раз, ~1 минута)

1. Supabase → **SQL Editor** → New query.
2. Вставьте целиком `supabase/setup.sql` → **Run**.
   Файл содержит все миграции и демо-студии `pompon` и `murr` с демо-записями.
   Владелец демо-кабинета: `npm run tenant:owner -- pompon --email … --sql` → выполнить полученный SQL
   (или `npm run setup:sql -- --demo 10 --owner pompon:email:пароль` — такой файл в git не коммитьте).
3. Authentication → Sign In / Providers → Email: выключите **Allow new users to sign up** — владельцев создаём только сами.

`setup.sql` рассчитан на пустую базу. Обновления студий делайте через `tenant:publish` (ниже).

## 2. Локальный запуск

```bash
npm install
# .env.production уже содержит URL проекта и publishable-ключ (они публичные)
npm run dev        # http://127.0.0.1:5173/s/pompon
```
Для `npm run dev` создайте `.env.local` с теми же двумя переменными `VITE_SUPABASE_*`.

## 3. Публикация на Vercel

```bash
npm i -g vercel
vercel            # первый раз: привязать проект; Build: npm run build, Output: dist
vercel --prod
```
или: GitHub → Vercel → Import, переменные окружения `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.
`vercel.json` уже настраивает глубокие ссылки `/s/{slug}/...` на оболочку нужной студии.
Ссылка демо: `https://<ваш-проект>.vercel.app/s/pompon`.

Cloudflare Pages тоже подходит: `public/_redirects` и `public/_headers` в комплекте, build `npm run build`, output `dist`.

## 4. Конвейер студий

| Команда | Что делает |
|---|---|
| `npm run tenant:new -- <slug> --name "…" [--from pompon] [--phone …] [--address …] [--whatsapp 7…] [--rating 5 --reviews 175]` | новая студия из шаблона в `tenants/<slug>/business.json` |
| `npm run tenant:validate -- --all` | проверка схемы, ссылок на мастеров/категории, часов, файлов фото |
| `npm run tenant:publish -- <slug> --sql` | SQL для SQL Editor (если нет service-ключа на компьютере) |
| `npm run tenant:publish -- <slug> [--live] [--demo 8]` | публикация напрямую (нужны `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` в `.env`) |
| `npm run tenant:owner -- <slug> --email … [--password …] [--sql]` | владелец студии (без публичной регистрации) |
| `npm run tenant:verify -- <slug> [--site https://….vercel.app]` | проверка глазами анонимного клиента + статика + ответ сайта |
| `npm run setup:sql -- --demo 10 --owner slug:email:пароль` | пересобрать `supabase/setup.sql` |

После добавления студии нужен `npm run build` (+ деплой): сборка генерирует `dist/s/<slug>/` — оболочку с метаданными, манифест, иконки, maskable, apple-touch, стартовые экраны и `sw.js` в области студии. JS/CSS общий.

## 5. Статусы студии

- `preview` — демо: записи помечаются `is_demo`, на сайте плашка «Демо-версия». Уведомлений нет.
- `live` — `tenant:publish -- <slug> --live` после проверки `tenant:verify`.

## 6. Тесты

```bash
DATABASE_URL=postgres://… npm run test:db     # 16 SQL/интеграционных тестов (тестовая база!)
node scripts/serve-dist.mjs & npm run test:e2e # Playwright: запись → появилась у владельца
```
Тесты создают записи — запускайте на тестовой базе или локальном стеке.

## Секреты

В браузер попадают только `VITE_SUPABASE_URL` и publishable/anon-ключ. `service_role`/`sb_secret_…` и будущий `LLM_API_KEY` — только на сервере/в локальном `.env` для скриптов.
