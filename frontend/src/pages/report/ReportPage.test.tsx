import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import { api } from '../../api/client'
import { formatMoney, formatRoundedMoney } from '../../lib/money'
import { makeReportSummary, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { setupUser } from '../../test/user'
import { ReportPage } from './ReportPage'
import type { ReportProduct, ReportSummary } from './api'

function mockReport(
  overrides: Partial<ReportSummary> = {},
  total = 1,
  rowOverrides: Partial<ReportProduct> = {},
) {
  const row = { revenue: 120000, profit: 40000, revenue_unknown_cost: 0, ...rowOverrides }
  return vi.spyOn(api, 'GET').mockImplementation(((
    path: string,
    init?: { params: { query: { limit?: number; offset?: number } } },
  ) => {
    if (path === '/api/reports/summary') return ok(makeReportSummary(overrides))
    if (path === '/api/reports/products')
      return ok({
        items: [
          {
            product_id: (init?.params.query.offset ?? 0) + 1,
            article: 'OC-90',
            name: 'Фильтр',
            unit: 'шт',
            qty: 2,
            ...row,
            cost: 80000,
          },
        ],
        total,
      })
    return ok({
      items: [
        { customer_id: null, name: null, sales_count: 1, ...row },
        {
          customer_id: 7,
          name: 'Ержан',
          sales_count: 1,
          revenue: 10000,
          profit: 1000,
          revenue_unknown_cost: 0,
        },
      ],
      total: 2,
    })
  }) as never)
}
function renderReport(route = '/report?from=2026-09-01&to=2026-09-30') {
  return renderWithDataRouter([{ path: '/report', element: <ReportPage /> }], { route })
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('ReportPage', () => {
  it.each([
    [2, 10050, true],
    [0, 0, false],
  ])(
    'shows return totals and rounded defect loss only when present (%s)',
    async (count, loss, shown) => {
      mockReport({ returns_count: count, returns_total: 30000, defect_loss: loss, sales_count: 0 })
      renderReport()
      await screen.findByTestId('report-profit')
      expect(Boolean(screen.queryByText('Возвраты: 300 ₸ (2)'))).toBe(shown)
      expect(Boolean(screen.queryByText('Потери на браке: 101 ₸'))).toBe(shown)
    },
  )
  it.each([
    ['ru', 'Неизвестно', 'частично'],
    ['kk', 'Белгісіз', 'ішінара'],
    ['zh', '未知', '部分'],
  ])(
    'shows unknown profit instead of zero in both reports (%s)',
    async (language, unknown, partial) => {
      await i18n.changeLanguage(language)
      mockReport({}, 1, { profit: 0, revenue_unknown_cost: 120000 })
      renderReport()
      await waitFor(() => expect(screen.getAllByText(unknown)).toHaveLength(4))
      for (const name of ['OC-90', i18n.t('sell.review.retail')]) {
        const table = screen.getAllByRole('table').find((table) => within(table).queryByText(name))!
        expect(within(table).getByText(unknown)).toBeTruthy()
        expect(within(table).queryByText('0 ₸')).toBeNull()
      }
      expect(screen.queryByText(partial)).toBeNull()
    },
  )
  it.each([
    ['ru', 'Неизвестно', 'частично'],
    ['kk', 'Белгісіз', 'ішінара'],
    ['zh', '未知', '部分'],
  ])(
    'marks partial rounded profit in both reports with a focusable explanation (%s)',
    async (language, unknown, partial) => {
      await i18n.changeLanguage(language)
      mockReport({}, 1, { profit: -10050, revenue_unknown_cost: 60000 })
      renderReport()
      await waitFor(() => expect(screen.getAllByText(partial)).toHaveLength(4))
      const labels = screen.getAllByText(partial)
      for (const label of labels) {
        expect(label.parentElement?.textContent).toContain(formatRoundedMoney(-10050))
        expect(label.parentElement?.getAttribute('style')).toContain('--q-color-warning-text')
      }
      expect(screen.queryByText(unknown)).toBeNull()
      labels[0].focus()
      expect(await screen.findByRole('tooltip')).toHaveProperty(
        'textContent',
        i18n.t('report.partialHint'),
      )
    },
  )
  it('shows unknown costs, negative profit in warning color, received money and retail customer', async () => {
    mockReport({ profit: -20050, revenue_unknown_cost: 15050 })
    renderReport()
    const profit = await screen.findByTestId('report-profit')
    expect(profit.textContent).toBe(formatRoundedMoney(-20050))
    expect(profit.getAttribute('style')).toContain('--q-color-warning-text')
    expect(screen.getByText(/Продажи без закупочной цены/).textContent).toContain(
      formatRoundedMoney(15050),
    )
    expect(screen.getByText('Получено денег')).toBeTruthy()
    expect((await screen.findAllByRole('link', { name: 'Ержан' }))[0].getAttribute('href')).toBe(
      '/customers/7',
    )
    expect(screen.getAllByText('Розничный покупатель').length).toBeGreaterThan(0)
  })
  it.each([
    ['2026-09-01', '2026-11-01', true],
    ['2026-09-01', '2026-11-02', false],
  ])('shows graph only for up to 62 days (%s to %s)', async (from, to, shown) => {
    mockReport()
    renderReport(`/report?from=${from}&to=${to}`)
    await screen.findByTestId('report-profit')
    expect(screen.queryByTestId('report-chart') !== null).toBe(shown)
  })
  it('retains debt payments in an empty sales period', async () => {
    mockReport({
      sales_count: 0,
      revenue: 0,
      profit: 0,
      received: { cash: 100000, card: 0, total: 100000 },
    })
    renderReport()
    expect(await screen.findByText('За этот период продаж не было.')).toBeTruthy()
    expect(screen.getByText('Получено денег')).toBeTruthy()
    expect(screen.queryByTestId('report-chart')).toBeNull()
    expect(screen.queryByText('Самые продаваемые товары')).toBeNull()
  })
  it('defaults to the Almaty month and keeps presets in URL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-31T20:30:00Z'))
    const user = setupUser()
    mockReport()
    const { router } = renderReport('/report')
    await screen.findByTestId('report-profit')
    expect(router.state.location.search).toBe('?from=2027-01-01&to=2027-01-01')
    await user.click(screen.getByRole('button', { name: 'Прошлый месяц' }))
    expect(router.state.location.search).toBe('?from=2026-12-01&to=2026-12-31')
  })
  it.each(['from=2026-09-30&to=2026-09-01', 'from=2025-01-01&to=2026-01-02'])(
    'rejects invalid period without requests (%s)',
    (query) => {
      const get = mockReport()
      renderReport(`/report?${query}`)
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(get).not.toHaveBeenCalled()
    },
  )
  it('reveals pagination and resets it when period changes', async () => {
    const user = setupUser()
    const get = mockReport({}, 80)
    renderReport()
    await user.click(await screen.findByRole('button', { name: 'Показать все' }))
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/api/reports/products',
        expect.objectContaining({
          params: { query: expect.objectContaining({ limit: 50, offset: 0 }) },
        }),
      ),
    )
    await user.click(await screen.findByRole('button', { name: 'Следующая страница' }))
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/api/reports/products',
        expect.objectContaining({ params: { query: expect.objectContaining({ offset: 50 }) } }),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Сегодня' }))
    expect(await screen.findByRole('button', { name: 'Показать все' })).toBeTruthy()
  })
  it('exposes daily data as a table and tooltip on focus', async () => {
    mockReport({ days: [{ date: '2026-09-27', revenue: 120005, profit: -20050 }] })
    renderReport()
    const chart = await screen.findByTestId('report-chart')
    expect(chart.getAttribute('data-negative')).toBe('true')
    const table = screen.getByRole('table', { name: 'По дням' })
    expect(within(table).getByText('27.09.2026')).toBeTruthy()
    expect(
      within(table).getByText(formatRoundedMoney(-20050).replaceAll('\u00a0', ' ')),
    ).toBeTruthy()
    expect(within(table).getByText(formatMoney(120005).replaceAll('\u00a0', ' '))).toBeTruthy()
    const column = chart.querySelector<HTMLElement>('[tabindex="0"]')!
    column.focus()
    expect(column.getAttribute('aria-label')).toContain(formatRoundedMoney(-20050))
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip.textContent).toContain(formatRoundedMoney(-20050))
    expect(tooltip.textContent).toContain(formatMoney(120005))
  })
})
