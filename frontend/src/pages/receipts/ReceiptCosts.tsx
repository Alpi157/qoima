import { Anchor, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Card, DataTable } from '../../components/ui'
import { formatCurrency } from '../../lib/currency'
import { formatDate } from '../../lib/dates'
import { unitLabel } from '../../lib/labels'
import { formatMoney } from '../../lib/money'
import { METHOD_KEYS } from '../receive/receiptLabels'
import type { Receipt } from './api'

export function ReceiptRate({ receipt }: { receipt: Receipt }) {
  const { t } = useTranslation()
  return (
    <Stack gap="xs">
      <Text>
        {t('receive.fx.title')}: {t(`receive.fx.${receipt.currency}`)}
      </Text>
      {receipt.currency !== 'KZT' && (
        <>
          <Text>
            {t('receive.fx.rate')}: {receipt.exchange_rate}
          </Text>
          <Text c="dimmed">
            {receipt.rate_source === 'manual' ? (
              <>
                {t('receive.fx.manual')} · {receipt.rate_date && formatDate(receipt.rate_date)}
              </>
            ) : (
              receipt.rate_date && t('receive.fx.exact', { date: formatDate(receipt.rate_date) })
            )}
          </Text>
        </>
      )}
    </Stack>
  )
}
export function ReceiptCosts({ receipt }: { receipt: Receipt }) {
  const { t } = useTranslation()
  type Line = Receipt['lines'][number]
  const price = (line: Line) =>
    line.unit_price_minor === null ? '—' : formatCurrency(line.unit_price_minor, receipt.currency)
  const goods = (line: Line) => (line.goods_total === null ? '—' : formatMoney(line.goods_total))
  const cost = (line: Line) => (line.unit_cost === null ? '—' : formatMoney(line.unit_cost))
  const total = (line: Line) =>
    line.goods_total === null
      ? '—'
      : formatMoney(BigInt(line.goods_total) + BigInt(line.expenses_total))
  return (
    <Stack gap="lg">
      <DataTable
        rows={receipt.lines}
        rowKey={(line) => line.product_id}
        minWidth={1000}
        columns={[
          {
            key: 'product',
            header: t('receipts.lines.article'),
            cell: (line) => (
              <Stack gap={0}>
                <Anchor component={Link} to={`/products/${line.product_id}`} fw={600}>
                  {line.article}
                </Anchor>
                <Text>{line.name}</Text>
              </Stack>
            ),
          },
          {
            key: 'qty',
            header: t('receipts.lines.qty'),
            numeric: true,
            cell: (line) => `${line.qty} ${unitLabel(line.unit)}`,
          },
          { key: 'price', header: t('products.purchases.price'), numeric: true, cell: price },
          { key: 'goods', header: t('receipts.currencyGoods'), numeric: true, cell: goods },
          {
            key: 'expenses',
            header: t('receipts.lineExpenses'),
            numeric: true,
            cell: (line) => formatMoney(line.expenses_total),
          },
          { key: 'cost', header: t('products.purchases.cost'), numeric: true, cell: cost },
          { key: 'sum', header: t('receipts.lines.sum'), numeric: true, cell: total },
        ]}
        mobileCard={(line) => (
          <Stack gap="xs">
            <Anchor component={Link} to={`/products/${line.product_id}`} fw={600}>
              {line.article}
            </Anchor>
            <Text>{line.name}</Text>
            <Text>
              {line.qty} {unitLabel(line.unit)} × {price(line)}
            </Text>
            <Text>
              {t('receipts.currencyGoods')}: {goods(line)}
            </Text>
            <Text>
              {t('receipts.lineExpenses')}: {formatMoney(line.expenses_total)}
            </Text>
            <Text>
              {t('products.purchases.cost')}: {cost(line)}
            </Text>
            <Text fw={600}>
              {t('receipts.lines.sum')}: {total(line)}
            </Text>
          </Stack>
        )}
      />
      {receipt.expenses.length > 0 && (
        <Stack gap="md">
          <Text fz="var(--q-fz-h3)" fw={600}>
            {t('receive.expenses.title')}
          </Text>
          {receipt.expenses.map((expense) => (
            <Card key={expense.id}>
              <Stack gap="sm">
                <Text fw={600}>{t(`receive.expenses.${expense.kind}`)}</Text>
                <Text>
                  {expense.currency !== 'KZT' && (
                    <>{formatCurrency(expense.amount_minor, expense.currency)} = </>
                  )}
                  {formatMoney(expense.amount_tiyn)}
                </Text>
                {expense.currency !== 'KZT' && (
                  <Text>
                    {t('receive.fx.rate')}: {expense.exchange_rate} ·{' '}
                    {expense.rate_source === 'manual'
                      ? t('receive.fx.manual')
                      : expense.rate_date &&
                        t('receive.fx.exact', { date: formatDate(expense.rate_date) })}
                  </Text>
                )}
                <Text>{t(METHOD_KEYS[expense.allocation_method])}</Text>
                {expense.is_vat_credit && (
                  <Text>
                    {t('receive.review.vat', { amount: formatMoney(expense.amount_tiyn) })}
                  </Text>
                )}
                {expense.allocations.map((part) => (
                  <Text key={part.receipt_line_id}>
                    {receipt.lines.find((line) => line.product_id === part.product_id)?.article ??
                      part.product_id}
                    : {formatMoney(part.amount_tiyn)}
                  </Text>
                ))}
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
      {receipt.vat_credit_total > 0 && (
        <Text>{t('receive.review.vat', { amount: formatMoney(receipt.vat_credit_total) })}</Text>
      )}
    </Stack>
  )
}
