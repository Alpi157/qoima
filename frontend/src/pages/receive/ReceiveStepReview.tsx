import { Button, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { StickyActions } from '../../components/flow'
import { Card, PageHeader } from '../../components/ui'
import { displayRate, formatCurrency, halfUp } from '../../lib/currency'
import { unitLabel } from '../../lib/labels'
import { formatMoney, parseMoney } from '../../lib/money'
import type { ReceiptPreview } from '../receipts/api'
import type { ReceiptDraft } from './receiptDraft'
import { METHOD_KEYS } from './receiptLabels'
import type { ReactNode } from 'react'

export function ReceiveStepReview({
  preview,
  draft,
  onBack,
  onSave,
  busy,
  unknown,
  warnings,
  error,
}: {
  preview: ReceiptPreview | null
  draft: ReceiptDraft
  onBack: () => void
  onSave: () => void
  busy: boolean
  unknown: boolean
  warnings: ReactNode
  error: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('receive.review.title')} />
      <Stack gap="lg" maw={1000}>
        {preview && (
          <>
            <Card>
              <Stack gap="md">
                <Text>
                  {t('receive.review.goods', {
                    currencyTotal: formatCurrency(
                      preview.lines.reduce(
                        (sum, line) => sum + BigInt(line.qty) * BigInt(line.unit_price_minor),
                        0n,
                      ),
                      preview.currency,
                    ),
                    tengeTotal: formatMoney(preview.goods_total),
                  })}
                </Text>
                <Text>
                  {t('receive.review.expenses', { amount: formatMoney(preview.expenses_total) })}
                </Text>
                <Text fz="var(--q-fz-h2)" fw={700} data-testid="currency-receipt-total">
                  {t('receive.review.total', { amount: formatMoney(preview.total_cost) })}
                </Text>
                {preview.vat_credit_total > 0 && (
                  <Text>
                    {t('receive.review.vat', { amount: formatMoney(preview.vat_credit_total) })}
                  </Text>
                )}
              </Stack>
            </Card>
            {preview.lines.map((line) => (
              <Card key={line.product_id}>
                <Stack gap="sm">
                  <Text fw={600}>
                    {line.article} · {line.name}
                  </Text>
                  <Text>
                    {line.qty} {unitLabel(line.unit)}
                  </Text>
                  <Text data-testid="receipt-cost-chain" style={{ overflowWrap: 'anywhere' }}>
                    {t('receive.review.chain', {
                      price: formatCurrency(line.unit_price_minor, preview.currency),
                      rate: displayRate(preview.exchange_rate),
                      goods: formatMoney(halfUp(BigInt(line.goods_total), BigInt(line.qty))),
                      expenses: formatMoney(halfUp(BigInt(line.expenses_total), BigInt(line.qty))),
                      unit: unitLabel(line.unit),
                      unitCost: formatMoney(line.unit_cost),
                    })}
                  </Text>
                  {line.markup_percent !== null && (
                    <Text>{t('receive.review.markup', { markup: line.markup_percent })}</Text>
                  )}
                </Stack>
              </Card>
            ))}
            {preview.expenses.map((expense) => {
              const input = draft.expenses[expense.index]
              return (
                <Card key={expense.index}>
                  <Stack gap="sm">
                    <Text fw={600}>{t(`receive.expenses.${expense.kind}`)}</Text>
                    <Text>
                      {input && input.currency !== 'KZT' && (
                        <>{formatCurrency(parseMoneySafe(input.amount), input.currency)} = </>
                      )}
                      {formatMoney(expense.amount_tiyn)}
                    </Text>
                    <Text>{input && t(METHOD_KEYS[input.method])}</Text>
                  </Stack>
                </Card>
              )
            })}
          </>
        )}
        {error}
        {warnings}
        <StickyActions>
          <Button variant="default" onClick={onBack}>
            {t('receive.review.back')}
          </Button>
          {!unknown && (
            <Button size="lg" onClick={onSave} loading={busy} disabled={!preview}>
              {preview?.warnings.length ? t('receive.warnings.confirm') : t('common.save')}
            </Button>
          )}
        </StickyActions>
      </Stack>
    </>
  )
}

function parseMoneySafe(value: string) {
  return parseMoney(value) ?? 0
}
