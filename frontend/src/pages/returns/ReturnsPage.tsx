import { Anchor, Group, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { PageLoader } from '../../components/PageLoader'
import { PeriodInput } from '../../components/PeriodInput'
import { QueryError } from '../../components/QueryError'
import {
  Card,
  DataTable,
  PageContainer,
  PageHeader,
  RowLink,
  Stat,
  useBackToMore,
} from '../../components/ui'
import { dateParam, formatDateTime } from '../../lib/dates'
import { formatAmount, formatMoney } from '../../lib/money'
import { useListParams } from '../../lib/useListParams'
import { type ReturnListItem, useReturns } from './api'
import { ReturnStatusBadge } from './ReturnStatusBadge'

export function ReturnsPage() {
  const { t } = useTranslation()
  const { page, searchParams, setPage, setParams } = useListParams()
  const from = dateParam(searchParams.get('from'))
  const to = dateParam(searchParams.get('to'))
  const query = useReturns({ from, to, page })
  const back = useBackToMore()
  const sale = (row: ReturnListItem) => (
    <Anchor component={Link} to={`/sales/${row.sale.id}`}>
      {t('returns.sale', { number: row.sale.number })}
    </Anchor>
  )
  const customer = (row: ReturnListItem) =>
    row.customer ? (
      <Anchor component={Link} to={`/customers/${row.customer.id}`}>
        {row.customer.name}
      </Anchor>
    ) : (
      t('sell.review.retail')
    )
  return (
    <PageContainer>
      <PageHeader back={back} title={t('returns.listTitle')} />
      <PeriodInput
        from={from}
        to={to}
        onChange={(from, to) => setParams({ from, to })}
        withQuickRanges
      />
      {query.isPending ? (
        <PageLoader />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <Stack gap="md">
          <Card>
            <Stat label={t('returns.total')} value={formatAmount(query.data.sum_posted)} unit="₸" />
          </Card>
          {query.data.total === 0 ? (
            <EmptyState text={from || to ? t('common.nothingFound') : t('returns.empty')} />
          ) : (
            <DataTable
              rows={query.data.items}
              rowKey={(row) => row.id}
              rowHref={(row) => `/returns/${row.id}`}
              mobileCardWithLinks
              dimmed={(row) => row.status === 'cancelled'}
              columns={[
                {
                  key: 'number',
                  header: t('sales.list.number'),
                  cell: (row) => <RowLink to={`/returns/${row.id}`}>{row.number}</RowLink>,
                },
                {
                  key: 'date',
                  header: t('sales.list.date'),
                  cell: (row) => formatDateTime(row.returned_at),
                },
                { key: 'sale', header: t('customers.ledger.document'), cell: sale },
                { key: 'customer', header: t('sales.list.customer'), cell: customer },
                {
                  key: 'total',
                  header: t('sales.list.total'),
                  numeric: true,
                  cell: (row) => formatMoney(row.total),
                },
                {
                  key: 'status',
                  header: t('sales.list.status'),
                  cell: (row) => <ReturnStatusBadge status={row.status} />,
                },
              ]}
              mobileCard={(row) => (
                <Stack gap="xs">
                  <Group justify="space-between">
                    <RowLink to={`/returns/${row.id}`}>
                      {t('returns.title', { number: row.number })}
                    </RowLink>
                    <ReturnStatusBadge status={row.status} />
                  </Group>
                  <Text size="sm" c="dimmed">
                    {formatDateTime(row.returned_at)}
                  </Text>
                  {sale(row)}
                  {customer(row)}
                  <Text fw={600}>{formatMoney(row.total)}</Text>
                </Stack>
              )}
            />
          )}
          <ListPagination total={query.data.total} page={page} onChange={setPage} />
        </Stack>
      )}
    </PageContainer>
  )
}
