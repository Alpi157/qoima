import { SimpleGrid, Stack, Text } from '@mantine/core'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import {
  Card,
  DataTable,
  PageContainer,
  PageHeader,
  RowLink,
  SectionTitle,
  Stat,
  useBackToMore,
} from '../../components/ui'
import { formatAmount, formatMoney } from '../../lib/money'
import { PAGE_SIZE } from '../../lib/pagination'
import { useListParams } from '../../lib/useListParams'
import { type Customer, useCustomerDebts } from '../customers/api'

function DebtTable({ items, overpaid = false }: { items: Customer[]; overpaid?: boolean }) {
  const { t } = useTranslation()
  return (
    <DataTable
      rows={items}
      rowKey={(row) => row.id}
      rowHref={(row) => `/customers/${row.id}`}
      columns={[
        {
          key: 'name',
          header: t('debts.customer'),
          cell: (row) => <RowLink to={`/customers/${row.id}`}>{row.name}</RowLink>,
        },
        { key: 'phone', header: t('debts.phone'), cell: (row) => row.phone, nowrap: true },
        {
          key: 'debt',
          header: overpaid ? t('customers.debt.overpaid') : t('debts.amount'),
          cell: (row) => <Text fw={700}>{formatMoney(Math.abs(row.debt))}</Text>,
          numeric: true,
        },
      ]}
      mobileCard={(row) => (
        <Stack gap="xs">
          <Text fw={600}>{row.name}</Text>
          {row.phone && <Text>{row.phone}</Text>}
          <Text fw={700}>{formatMoney(Math.abs(row.debt))}</Text>
        </Stack>
      )}
    />
  )
}

export function DebtsPage() {
  const { t } = useTranslation()
  const back = useBackToMore()
  const { page, setPage } = useListParams()
  const query = useCustomerDebts(page)
  useEffect(() => {
    if (query.data && !query.isPlaceholderData && page > 1 && query.data.items.length === 0)
      setPage(Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)))
  }, [query.data, query.isPlaceholderData, page, setPage])
  const debtors = query.data?.items.filter((row) => row.debt > 0) ?? []
  const overpaid = query.data?.items.filter((row) => row.debt < 0) ?? []
  return (
    <PageContainer>
      <PageHeader back={back} title={t('debts.title')} />
      {query.isPending ? (
        <PageLoader />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          <Card>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
              <Stat
                size="display"
                label={t('debts.total')}
                value={formatAmount(query.data.total_debt)}
                unit="₸"
              />
              <Stat label={t('debts.count')} value={query.data.debtors_count} />
            </SimpleGrid>
          </Card>
          {query.data.debtors_count === 0 && <EmptyState text={t('debts.empty')} />}
          {debtors.length > 0 && <DebtTable items={debtors} />}
          {overpaid.length > 0 && (
            <Stack gap="md">
              <SectionTitle>{t('debts.overpaid')}</SectionTitle>
              <DebtTable items={overpaid} overpaid />
            </Stack>
          )}
          <ListPagination total={query.data.total} page={page} onChange={setPage} />
        </>
      )}
    </PageContainer>
  )
}
