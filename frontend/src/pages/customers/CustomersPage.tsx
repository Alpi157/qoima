import { Button, Group, Loader, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { QueryError } from '../../components/QueryError'
import { SearchInput } from '../../components/SearchInput'
import {
  DataTable,
  type DataTableColumn,
  PageContainer,
  PageHeader,
  RowLink,
  useBackToMore,
} from '../../components/ui'
import { useListParams } from '../../lib/useListParams'
import { type Customer, useCustomers } from './api'
import { CustomerFormModal } from './CustomerFormModal'

const customerPath = (customer: Customer) => `/customers/${customer.id}`

function CustomerTable({ items }: { items: Customer[] }) {
  const { t } = useTranslation()
  const columns: DataTableColumn<Customer>[] = [
    {
      key: 'name',
      header: t('customers.list.name'),
      cell: (customer) => <RowLink to={customerPath(customer)}>{customer.name}</RowLink>,
    },
    {
      key: 'phone',
      header: t('customers.list.phone'),
      nowrap: true,
      cell: (customer) => customer.phone,
    },
    {
      key: 'note',
      header: t('customers.list.note'),
      cell: (customer) => (
        <Text inherit lineClamp={1}>
          {customer.note}
        </Text>
      ),
    },
  ]
  return (
    <DataTable
      rows={items}
      rowKey={(customer) => customer.id}
      columns={columns}
      rowHref={customerPath}
      mobileCard={(customer) => (
        <Stack gap="xs">
          <Text fw={600}>{customer.name}</Text>
          {customer.phone && <Text>{customer.phone}</Text>}
          {customer.note && (
            <Text size="sm" c="dimmed" lineClamp={2}>
              {customer.note}
            </Text>
          )}
        </Stack>
      )}
    />
  )
}

export function CustomersPage() {
  const { q, page, setQ, setPage } = useListParams()
  const [formOpened, form] = useDisclosure()
  const customers = useCustomers({ q, page })
  const { t } = useTranslation()
  const backToMore = useBackToMore()

  return (
    <PageContainer>
      <PageHeader
        back={backToMore}
        title={t('customers.list.title')}
        actions={<Button onClick={form.open}>{t('customers.list.add')}</Button>}
      />

      <SearchInput
        value={q}
        onSearch={setQ}
        autoFocus
        size="lg"
        placeholder={t('customers.list.searchPlaceholder')}
        aria-label={t('customers.list.searchLabel')}
      />

      {customers.isPending ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : customers.isError ? (
        <QueryError error={customers.error} onRetry={() => customers.refetch()} />
      ) : customers.data.items.length === 0 && page === 1 ? (
        q ? (
          <EmptyState text={t('common.nothingFound')} />
        ) : (
          <EmptyState
            text={t('customers.list.empty')}
            actionLabel={t('customers.list.addFirst')}
            onAction={form.open}
          />
        )
      ) : (
        <Stack gap="md">
          <Text c="dimmed" size="sm">
            {t('common.found', { count: customers.data.total })}
          </Text>
          <CustomerTable items={customers.data.items} />
          <ListPagination total={customers.data.total} page={page} onChange={setPage} />
        </Stack>
      )}

      <CustomerFormModal opened={formOpened} onClose={form.close} />
    </PageContainer>
  )
}
