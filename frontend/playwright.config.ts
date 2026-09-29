import { defineConfig } from '@playwright/test'

// Screenshots of every screen on the demo database (docs/design/design-system.md, «Проверка
// глазами»). Run through `make screenshots`: it recreates qoima_demo and sets DEMO_PASSWORD.
// Own ports, so the working database and the dev servers on 8000 and 5173 are not touched.
const API_PORT = 8011
const WEB_PORT = 5183
const DESKTOP = { width: 1366, height: 800 }
const PHONE = { width: 390, height: 844 }

export default defineConfig({
  testDir: './e2e',
  outputDir: './node_modules/.playwright-results',
  reporter: 'list',
  timeout: 180_000,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    browserName: 'chromium',
    locale: 'kk-KZ',
    timezoneId: 'Asia/Almaty',
    deviceScaleFactor: 1,
  },
  // Screens first on both widths, then the flows that save a sale and a receiving: the numbers
  // on the screens (today's sales, stock) are the seed's on both widths.
  projects: [
    { name: '1366', testMatch: 'screenshots.spec.ts', use: { viewport: DESKTOP } },
    { name: '390', testMatch: 'screenshots.spec.ts', use: { viewport: PHONE } },
    {
      name: 'flows-1366',
      testMatch: 'flows.spec.ts',
      dependencies: ['1366', '390'],
      use: { viewport: DESKTOP },
    },
    {
      name: 'flows-390',
      testMatch: 'flows.spec.ts',
      dependencies: ['1366', '390'],
      use: { viewport: PHONE },
    },
  ],
  webServer: [
    {
      command: `uv run python -m app.demo serve --port ${API_PORT}`,
      cwd: '../backend',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      env: { QOIMA_API_TARGET: `http://localhost:${API_PORT}` },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
