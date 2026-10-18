import { Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { ListPagination } from '../../components/ListPagination'
import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import { DataTable, RowLink } from '../../components/ui/DataTable'
import { SectionTitle } from '../../components/ui'
import { formatCurrency } from '../../lib/currency'
import { formatDate } from '../../lib/dates'
import { unitLabel } from '../../lib/labels'
import { formatMoney } from '../../lib/money'
import { useListParams } from '../../lib/useListParams'
import { type ProductPurchase, useProductPurchases } from './api'

export function PurchaseHistory({ productId, unit }: { productId: number; unit: string }) {
  const { t } = useTranslation()
  const { page, setPage } = useListParams('purchasesPage')
  const query = useProductPurchases(productId, page)
  const price = (row: ProductPurchase) =>
    row.unit_price_minor === null ? '—' : formatCurrency(row.unit_price_minor, row.currency)
  const cost = (row: ProductPurchase) => (row.unit_cost === null ? '—' : formatMoney(row.unit_cost))
  const rate = (row: ProductPurchase) => (row.currency === 'KZT' ? '—' : row.exchange_rate)
  const href = (row: ProductPurchase) => `/receipts/${row.receipt_id}`
  return (
    <Stack gap="md">
      <SectionTitle>{t('products.purchases.title')}</SectionTitle>
      {query.isPending ? (
        <PageLoader />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.total === 0 ? (
        <Text c="dimmed">{t('products.purchases.empty')}</Text>
      ) : (
        <>
          <DataTable
            rows={query.data.items}
            rowKey={(row) => row.receipt_id}
            rowHref={href}
            columns={[
              {
                key: 'date',
                header: t('products.purchases.date'),
                cell: (row) => <RowLink to={href(row)}>{formatDate(row.received_at)}</RowLink>,
              },
              {
                key: 'qty',
                header: t('products.purchases.qty'),
                numeric: true,
                cell: (row) => `${row.qty} ${unitLabel(unit)}`,
              },
              { key: 'price', header: t('products.purchases.price'), numeric: true, cell: price },
              { key: 'rate', header: t('products.purchases.rate'), numeric: true, cell: rate },
              { key: 'cost', header: t('products.purchases.cost'), numeric: true, cell: cost },
            ]}
            mobileCard={(row) => (
              <Stack gap="xs">
                <Text fw={600}>{formatDate(row.received_at)}</Text>
                <Text>
                  {t('products.purchases.qty')}: {row.qty} {unitLabel(unit)}
                </Text>
                <Text>
                  {t('products.purchases.price')}: {price(row)}
                </Text>
                <Text>
                  {t('products.purchases.rate')}: {rate(row)}
                </Text>
                <Text>
                  {t('products.purchases.cost')}: {cost(row)}
                </Text>
              </Stack>
            )}
          />
          <ListPagination total={query.data.total} page={page} onChange={setPage} />
        </>
      )}
    </Stack>
  )
}
