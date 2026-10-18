import type { TFunction } from 'i18next'
import { formatDate } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import type { ReceiptWarning } from '../receipts/api'

export function receiptWarningText(warning: ReceiptWarning, t: TFunction): string {
  if (warning.code === 'rate_deviation') {
    const rate = warning.params
    return t('receive.warnings.rate_deviation', {
      rate: rate.rate,
      nbkRate: rate.nbk_rate,
      date: formatDate(rate.nbk_rate_date),
      percent: rate.percent,
    })
  }
  if (warning.code === 'cost_jump')
    return t('receive.warnings.cost_jump', {
      article: warning.params.article,
      unitCost: formatMoney(warning.params.unit_cost),
      previousCost: formatMoney(warning.params.previous_cost),
    })
  return t('receive.warnings.cost_not_below_price', {
    article: warning.params.article,
    unitCost: formatMoney(warning.params.unit_cost),
    salePrice: formatMoney(warning.params.sale_price),
  })
}
