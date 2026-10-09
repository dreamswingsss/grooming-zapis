# Клон под нового грумера за 6 минут

Пример: лид «ProХвост» из таблицы (5,0 · 175 отзывов в 2ГИС, WhatsApp).

1. **Создать студию** (1 мин)
   ```bash
   npm run tenant:new -- prohvost --name "ProХвост" --phone "+7 (982) 747-08-80" \
     --address "ул. Шаумяна, 105/1" --whatsapp 79827470880 --rating 5 --reviews 175 --rating-source 2ГИС
   ```
2. **Поправить `tenants/prohvost/business.json`** (2 мин): цены из их соцсетей/прайса, часы работы, имена мастеров, акцент `public.accent` под их фирменный цвет. Фото — стоковые (как в шаблоне) или с их разрешения в `tenants/prohvost/media/`.
   Рейтинг и отзывы указывайте только реальные — из 2ГИС/Яндекс Карт.
3. **Проверить** (10 сек): `npm run tenant:validate -- prohvost`
4. **Опубликовать** (1 мин): `npm run tenant:publish -- prohvost --sql` → вставить файл в SQL Editor → Run.
   (Или напрямую, если в `.env` есть service-ключ: `npm run tenant:publish -- prohvost --demo 6`.)
5. **Собрать и выкатить** (1–2 мин): `vercel --prod`.
6. **Проверить** (20 сек): `npm run tenant:verify -- prohvost --site https://<проект>.vercel.app`

Ссылка для сообщения: `https://<проект>.vercel.app/s/prohvost`.
Если зайдёт — `tenant:owner -- prohvost --email их@почта` и `tenant:publish -- prohvost --live`.
Записи, которые уже были, при переиздании не теряются.
