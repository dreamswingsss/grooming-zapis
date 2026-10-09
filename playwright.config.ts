import { defineConfig, devices } from '@playwright/test'

// Требует запущенных: Supabase (локальный стек или тестовый проект) и `node scripts/serve-dist.mjs` после `npm run build`.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    ...devices['iPhone 14'],
    browserName: 'chromium',
    locale: 'ru-RU',
    timezoneId: 'Asia/Yekaterinburg',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
})
