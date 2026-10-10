import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import i18n from 'i18next'
import { renderWithProviders } from '../../test/render'
import { PaymentStatusBadge } from './PaymentStatusBadge'

it.each(['ru', 'kk', 'zh'])(
  'shows payment statuses in %s with the shared tones',
  async (language) => {
    await i18n.changeLanguage(language)
    renderWithProviders(
      <>
        <PaymentStatusBadge status="unpaid" outstanding={10000} />
        <PaymentStatusBadge status="partial" outstanding={5000} />
        <PaymentStatusBadge status="returned" outstanding={0} />
        <PaymentStatusBadge status="paid" outstanding={0} />
        <PaymentStatusBadge status={null} outstanding={null} />
      </>,
    )
    for (const key of ['unpaid', 'partial'] as const) {
      const badge = screen.getByText(
        i18n
          .t(`sales.paymentStatus.${key}`, { amount: key === 'unpaid' ? '100 ₸' : '50 ₸' })
          .replaceAll('\u00a0', ' '),
      )
      expect(badge.closest('[data-tone]')?.getAttribute('data-tone')).toBe('warning')
    }
    expect(
      screen
        .getByText(i18n.t('sales.paymentStatus.returned'))
        .closest('[data-tone]')
        ?.getAttribute('data-tone'),
    ).toBe('neutral')
    expect(screen.queryByText(i18n.t('sales.paymentStatus.paid'))).toBeNull()
  },
)

it('shows paid in sale details', () => {
  renderWithProviders(<PaymentStatusBadge status="paid" outstanding={0} detail />)
  expect(screen.getByText('Оплачено')).toBeTruthy()
})
