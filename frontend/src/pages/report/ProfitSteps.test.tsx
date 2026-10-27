import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import i18n from 'i18next'
import { makeReportSummary } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { ProfitSteps } from './ProfitSteps'

it.each(['kk', 'ru', 'zh'])(
  'shows an expense-only loss with a minus and category link in %s',
  async (language) => {
    await i18n.changeLanguage(language)
    renderWithProviders(
      <ProfitSteps
        from="2026-09-01"
        to="2026-09-30"
        data={makeReportSummary({
          revenue: 0,
          cost: 0,
          profit: 0,
          sales_count: 0,
          expenses_total: 10000000,
          expenses_count: 1,
          operating_total: 10000000,
          profit_after_expenses: -10000000,
          expenses_by_category: [{ category: 'rent', amount: 10000000, count: 1 }],
        })}
      />,
    )
    expect(screen.getByTestId('profit-after-expenses').textContent).toContain('-100')
    expect(
      screen.getByRole('link', { name: i18n.t('report.showAdjustments') }).getAttribute('href'),
    ).toBe('/expenses?from=2026-09-01&to=2026-09-30')
    expect(screen.queryByText(i18n.t('profit.commission', { percent: '0' }))).toBeNull()
    expect(screen.queryByText(i18n.t('profit.tax', { percent: '0' }))).toBeNull()
  },
)

it('hides the whole ladder for an empty period', () => {
  renderWithProviders(
    <ProfitSteps from="2026-09-01" to="2026-09-30" data={makeReportSummary({ revenue: 0 })} />,
  )
  expect(screen.queryByTestId('profit-steps')).toBeNull()
})

it('shows commission, estimated tax, surplus, defect, rates and unknown rows', () => {
  renderWithProviders(
    <ProfitSteps
      from="2026-09-01"
      to="2026-09-30"
      data={makeReportSummary({
        card_commission: 400000,
        card_commission_percent: '1',
        tax_estimate: 3000000,
        tax_percent: '3',
        surplus_value: 500000,
        write_off_value: 500000,
        defect_loss: 1000000,
        rate_effect: 7875000,
        buy_today_unknown_count: 2,
      })}
    />,
  )
  expect(screen.getByText('Комиссия за карту (1%)')).toBeTruthy()
  expect(screen.getByText('Налог, оценка (3%)')).toBeTruthy()
  expect(screen.getByText('Найдено излишков')).toBeTruthy()
  expect(screen.getByText(/в том числе потери на браке/)).toBeTruthy()
  expect(screen.getByText(/дороже на/)).toBeTruthy()
  expect(screen.getByText(/Строк продаж без расчёта/)).toBeTruthy()
})

it('shows a settings hint when both rates are zero', () => {
  renderWithProviders(<ProfitSteps from="2026-09-01" to="2026-09-30" data={makeReportSummary()} />)
  expect(screen.getByRole('link', { name: 'Настройках' }).getAttribute('href')).toBe('/settings')
})

it('retains a minus for a negative profit rounded to zero tenge', () => {
  renderWithProviders(
    <ProfitSteps
      from="2026-09-01"
      to="2026-09-30"
      data={makeReportSummary({
        revenue: 0,
        expenses_total: 1,
        operating_total: 1,
        profit_after_expenses: -1,
      })}
    />,
  )
  expect(screen.getByTestId('profit-after-expenses').textContent).toContain('-0')
})
