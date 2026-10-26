import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import { api } from '../../api/client'
import { formatMoney, formatRoundedMoney } from '../../lib/money'
import { makeReportSummary, ok } from '../../test/fixtures'
import { renderWithDataRouter } from '../../test/render'
import { setupUser } from '../../test/user'
import { ReportPage } from './ReportPage'
import type { ReportAdjustment, ReportProduct, ReportSummary } from './api'

function mockReport(
  overrides: Partial<ReportSummary> = {},
  total = 1,
  rowOverrides: Partial<ReportProduct> = {},
  adjustmentOverrides: Partial<ReportAdjustment> = {},
) {
  const row = { revenue: 120000, profit: 40000, revenue_unknown_cost: 0, ...rowOverrides }
  return vi.spyOn(api, 'GET').mockImplementation(((
    path: string,
    init?: { params: { query: { limit?: number; offset?: number; direction?: string } } },
  ) => {
    if (path === '/api/reports/summary') return ok(makeReportSummary(overrides))
    if (path === '/api/reports/adjustments')
      return ok({
        items: [
          {
            movement_id: (init?.params.query.offset ?? 0) + 1,
            created_at: '2026-09-27T09:00:00Z',
            product_id: 9,
            article: 'WRITE-OFF',
            name: 'Фильтр списания',
            unit: 'шт',
            qty: init?.params.query.direction === 'plus' ? 3 : -3,
            unit_cost: 201250,
            value: 603750,
            reason: 'Пересорт',
            created_by_name: 'Тест',
            ...adjustmentOverrides,
          },
        ],
        total,
      })
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
  it('retries a failed details request without hiding the summary', async () => {
    const user = setupUser()
    const get = mockReport({ write_off_count: 1, write_off_value: 603750 })
    const original = get.getMockImplementation() as unknown as (
      path: string,
      init: unknown,
    ) => unknown
    let attempts = 0
    get.mockImplementation(((path: string, init: unknown) => {
      if (path === '/api/reports/adjustments' && ++attempts === 1)
        return Promise.reject(new Error('Unavailable'))
      return original(path, init)
    }) as never)
    renderReport()
    await user.click(await screen.findByRole('button', { name: 'Показать' }))
    await user.click(await screen.findByRole('button', { name: 'Повторить' }))
    expect((await screen.findAllByText('Пересорт')).length).toBeGreaterThan(0)
    expect(screen.getByText('Списано: 6 038 ₸')).toBeTruthy()
    expect(attempts).toBe(2)
  })
  it('hides zero adjustment and discount rows and negative net discounts', async () => {
    mockReport({ discount_total: -1000 })
    renderReport()
    await screen.findByTestId('report-profit')
    expect(
      screen.queryByText(/Скидки:|Списано:|Найдено излишков:|Корректировки без закупочной цены:/),
    ).toBeNull()
    expect(screen.queryByText(/У части старых продаж/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Показать' })).toBeNull()
  })

  it('shows rounded summary, warnings and a zero-cost write-off without sales', async () => {
    mockReport({
      sales_count: 0,
      discount_total: 10050,
      discount_unknown_count: 1,
      write_off_count: 1,
      write_off_value: 0,
      surplus_value: 20050,
      adjustment_unknown_count: 2,
    })
    renderReport()
    expect(await screen.findByText('За этот период продаж не было.')).toBeTruthy()
    expect(screen.getByText('Скидки: 101 ₸ (уже учтены в выручке)')).toBeTruthy()
    expect(
      screen.getByText('У части старых продаж нет базовой цены, их скидка не посчитана.'),
    ).toBeTruthy()
    expect(screen.getByText('Списано: 0 ₸')).toBeTruthy()
    expect(screen.getByText('Найдено излишков: 201 ₸')).toBeTruthy()
    expect(screen.getByText('Корректировки без закупочной цены: 2. В сумму не вошли.')).toBeTruthy()
  })

  it.each(['minus', 'plus'] as const)(
    'loads and hides %s details with product links and pagination',
    async (direction) => {
      const user = setupUser()
      const get = mockReport(
        { write_off_count: 1, write_off_value: 603750, surplus_value: 603750 },
        80,
      )
      const { router } = renderReport()
      await screen.findByTestId('report-profit')
      expect(get).not.toHaveBeenCalledWith('/api/reports/adjustments', expect.anything())
      const section = within(screen.getByTestId(`report-adjustments-${direction}`))
      await user.click(section.getByRole('button', { name: 'Показать' }))
      expect((await section.findAllByText('Пересорт')).length).toBeGreaterThan(0)
      expect(
        section.getAllByText(formatMoney(603750).replaceAll('\u00a0', ' ')).length,
      ).toBeGreaterThan(0)
      expect(section.getAllByText('27.09.2026 14:00').length).toBeGreaterThan(0)
      await user.click(section.getByRole('button', { name: 'Следующая страница' }))
      await waitFor(() =>
        expect(get).toHaveBeenCalledWith('/api/reports/adjustments', {
          params: {
            query: { from: '2026-09-01', to: '2026-09-30', direction, limit: 50, offset: 50 },
          },
        }),
      )
      await user.click(section.getByRole('button', { name: 'Скрыть' }))
      expect(section.queryByText('Пересорт')).toBeNull()
      await user.click(section.getByRole('button', { name: 'Показать' }))
      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/reports/adjustments', {
          params: {
            query: { from: '2026-09-01', to: '2026-09-30', direction, limit: 50, offset: 0 },
          },
        }),
      )
      await user.click((await section.findAllByRole('link', { name: 'WRITE-OFF' }))[0])
      expect(router.state.location.pathname).toBe('/products/9')
    },
  )

  it('shows unknown detail values and resets disclosure on period change', async () => {
    const user = setupUser()
    mockReport({ write_off_count: 1 }, 1, {}, { unit_cost: null, value: null, reason: null })
    renderReport()
    await user.click(await screen.findByRole('button', { name: 'Показать' }))
    expect((await screen.findAllByText('—')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Сегодня' }))
    expect(await screen.findByRole('button', { name: 'Показать' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Скрыть' })).toBeNull()
  })
  it('shows zero profit when both revenue and unknown revenue are zero', async () => {
    await i18n.changeLanguage('kk')
    mockReport({}, 1, { revenue: 0, profit: 0, revenue_unknown_cost: 0 })
    renderReport()
    await screen.findAllByText('OC-90')
    for (const name of ['OC-90', i18n.t('sell.review.retail')]) {
      const table = screen.getAllByRole('table').find((table) => within(table).queryByText(name))!
      const row = within(table).getByText(name).closest('tr')!
      expect(row.lastElementChild?.textContent).toBe(formatRoundedMoney(0))
    }
    expect(screen.queryByText('Белгісіз')).toBeNull()
    expect(screen.queryByText('ішінара')).toBeNull()
  })

  it.each([120000, -120000])(
    'shows unknown profit for equal nonzero amounts (%i)',
    async (revenue) => {
      await i18n.changeLanguage('kk')
      mockReport({}, 1, { revenue, profit: 0, revenue_unknown_cost: revenue })
      renderReport()
      await waitFor(() => expect(screen.getAllByText('Белгісіз')).toHaveLength(4))
      expect(screen.queryByText('ішінара')).toBeNull()
    },
  )

  it('explains partially unknown negative revenue from returns', async () => {
    await i18n.changeLanguage('kk')
    mockReport({}, 1, { revenue: -120000, profit: -10050, revenue_unknown_cost: -60000 })
    renderReport()
    await waitFor(() => expect(screen.getAllByText('ішінара')).toHaveLength(4))
    const labels = screen.getAllByText('ішінара')
    for (const label of labels)
      expect(label.parentElement?.textContent).toContain(formatRoundedMoney(-10050))
    labels[0].focus()
    expect(await screen.findByRole('tooltip')).toHaveProperty(
      'textContent',
      i18n.t('report.partialHint'),
    )
  })

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
