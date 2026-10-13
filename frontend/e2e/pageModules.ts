import { expect, type Page } from '@playwright/test'

export const REPORT_MODULE =
  /\/(?:src\/pages\/report\/ReportPage\.tsx|assets\/ReportPage-[^/]+\.js)(?:\?.*)?$/

/** A successfully imported module whose component fails during render, in dev and builds. */
export async function breakReportRender(page: Page) {
  await page.route(REPORT_MODULE, async (route) => {
    const response = await route.fetch()
    expect(response.ok()).toBeTruthy()
    const source = await response.text()
    const names = new Set([
      ...Array.from(source.matchAll(/export\s+(?:function|const|class)\s+([\w$]+)/g), (m) => m[1]),
      ...Array.from(source.matchAll(/export\s*\{([^}]+)\}/g)).flatMap((m) =>
        m[1].split(',').map((part) =>
          part
            .trim()
            .split(/\s+as\s+/)
            .at(-1)!,
        ),
      ),
    ])
    expect(names.size).toBeGreaterThan(0)
    await route.fulfill({
      contentType: 'application/javascript',
      body: `function Broken(){throw new Error('E2E render failure')} export {${[...names].map((name) => `Broken as ${name}`).join(',')}};`,
    })
  })
}
