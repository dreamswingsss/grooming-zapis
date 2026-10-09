import { test, expect, type Page } from '@playwright/test'

const slug = process.env.E2E_SLUG ?? 'pompon'
const ownerEmail = process.env.E2E_OWNER_EMAIL ?? 'pompon@example.com'
const ownerPassword = process.env.E2E_OWNER_PASSWORD ?? ''

// Внешние фото и шрифты в изолированной среде недоступны — подменяем, чтобы не ждать таймаутов.
async function stubExternal(page: Page) {
  await page.route(/images\.unsplash\.com|fonts\.(googleapis|gstatic)\.com/, (r) =>
    r.request().resourceType() === 'image'
      ? r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#3a3530"/></svg>' })
      : r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  )
}

test('клиент записывается, запись появляется у владельца', async ({ page }) => {
  await stubExternal(page)
  const name = `Тест ${Date.now() % 100000}`

  await page.goto(`/s/${slug}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Записаться онлайн' }).click()

  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Выберите услугу' })).toBeVisible()
  await sheet.getByRole('button', { name: /Комплексный груминг/ }).click()
  await expect(sheet.getByRole('heading', { name: 'Размер питомца' })).toBeVisible()
  await sheet.getByRole('button', { name: /Мини/ }).click()
  await expect(sheet.getByRole('heading', { name: 'Мастер' })).toBeVisible()
  await sheet.getByRole('button', { name: /Любой мастер/ }).click()

  await expect(sheet.getByRole('heading', { name: 'Дата и время' })).toBeVisible()
  const firstSlot = sheet.locator('fieldset button').first()
  await expect(firstSlot).toBeVisible({ timeout: 15_000 })
  const time = (await firstSlot.textContent())!.trim()
  await firstSlot.click()
  await sheet.getByRole('button', { name: /Дальше/ }).click()

  await sheet.getByLabel(/Ваше имя/).fill(name)
  await sheet.getByLabel(/Телефон/).fill('9001234567')
  await sheet.getByLabel('Кличка').fill('Бусинка')
  await sheet.getByRole('button', { name: 'Записаться' }).click()

  await expect(sheet.getByRole('heading', { name: 'Вы записаны' })).toBeVisible({ timeout: 15_000 })
  await expect(sheet.getByText(time, { exact: false })).toBeVisible()
  const bookingLink = await sheet.getByRole('link', { name: 'Открыть запись' }).getAttribute('href')
  expect(bookingLink).toMatch(new RegExp(`/s/${slug}/b/`))
  const dayText = await sheet.locator('p.font-display').textContent()

  // Владелец
  await page.goto(`/s/${slug}/owner`)
  await page.getByLabel(/Почта/).fill(ownerEmail)
  await page.getByLabel(/Пароль/).fill(ownerPassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: /Сегодня/i })).toBeVisible({ timeout: 15_000 })

  // Листаем дни вперёд, пока не найдём запись (она может быть не на сегодня).
  let found = false
  for (let i = 0; i < 21 && !found; i++) {
    const row = page.getByRole('button', { name: new RegExp(`Бусинка.*${name}`) })
    if (await row.count()) {
      await row.first().click()
      found = true
      break
    }
    await page.getByRole('button', { name: 'Следующий день' }).click()
    await page.waitForTimeout(400)
  }
  expect(found, `запись «${name}» (${dayText}) не найдена в кабинете`).toBeTruthy()
  const detail = page.getByRole('dialog')
  await expect(detail.getByText(name)).toBeVisible()
  await expect(detail.getByText('+79001234567')).toBeVisible()
  await expect(detail.getByText(new RegExp(time))).toBeVisible()

  // Отметка «Клиент пришёл» реально меняет статус
  await detail.getByRole('button', { name: 'Клиент пришёл' }).click()
  await expect(detail.getByText('Клиент пришёл').first()).toBeVisible()
})
