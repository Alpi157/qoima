import { Anchor, Button, Group, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { isApiError } from '../../api/errors'
import { ListPagination } from '../../components/ListPagination'
import { NotFoundState } from '../../components/NotFoundState'
import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import {
  Card,
  DataTable,
  type DataTableColumn,
  PageContainer,
  PageHeader,
  RowLink,
  SectionTitle,
} from '../../components/ui'
import { formatDateTime } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { parseId } from '../../lib/routeParams'
import { useListParams } from '../../lib/useListParams'
import { type SaleListItem, useSales } from '../sales/api'
import { SaleStatusBadge } from '../sales/SaleStatusBadge'
import { type Customer, useCustomer } from './api'
import { CustomerFormModal } from './CustomerFormModal'

function SaleLink({ sale }: { sale: SaleListItem }) {
  const { t } = useTranslation()
  return (
    <RowLink to={`/sales/${sale.id}`}>
      {t('common.documentNumber', { number: sale.number })}
    </RowLink>
  )
}

function SaleTable({ items }: { items: SaleListItem[] }) {
  const { t } = useTranslation()
  const columns: DataTableColumn<SaleListItem>[] = [
    {
      key: 'number',
      header: t('customers.purchases.number'),
      nowrap: true,
      cell: (sale) => <SaleLink sale={sale} />,
    },
    {
      key: 'date',
      header: t('customers.purchases.date'),
      nowrap: true,
      cell: (sale) => formatDateTime(sale.sold_at),
    },
    {
      key: 'total',
      header: t('customers.purchases.total'),
      numeric: true,
      cell: (sale) => formatMoney(sale.total),
    },
    {
      key: 'status',
      header: t('customers.purchases.status'),
      cell: (sale) => <SaleStatusBadge status={sale.status} />,
    },
  ]
  return (
    <DataTable
      rows={items}
      rowKey={(sale) => sale.id}
      columns={columns}
      rowHref={(sale) => `/sales/${sale.id}`}
      dimmed={(sale) => sale.status === 'cancelled'}
      mobileCard={(sale) => (
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600}>{t('common.documentNumber', { number: sale.number })}</Text>
            <SaleStatusBadge status={sale.status} />
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {formatDateTime(sale.sold_at)}
            </Text>
            <Text fw={600}>{formatMoney(sale.total)}</Text>
          </Group>
        </Stack>
      )}
    />
  )
}

function PurchaseHistory({ customerId }: { customerId: number }) {
  const { page, setPage } = useListParams()
  const sales = useSales({ customerId, page })
  const { t } = useTranslation()

  if (sales.isPending) return <PageLoader />
  if (sales.isError) return <QueryError error={sales.error} onRetry={() => sales.refetch()} />
  if (sales.data.total === 0) return <Text c="dimmed">{t('customers.purchases.empty')}</Text>
  return (
    <Stack gap="md">
      <Text fw={600}>
        {t('customers.purchases.sum', { amount: formatMoney(sales.data.sum_posted) })}
      </Text>
      <SaleTable items={sales.data.items} />
      <ListPagination total={sales.data.total} page={page} onChange={setPage} />
    </Stack>
  )
}

function CustomerDetails({ customer }: { customer: Customer }) {
  const [editOpened, edit] = useDisclosure()
  const { t } = useTranslation()

  return (
    <PageContainer>
      <PageHeader
        back={{ to: '/customers', label: t('customers.card.back') }}
        title={customer.name}
        subtitle={
          customer.phone && (
            <Group gap="sm" component="span">
              <span>{customer.phone}</span>
              <Anchor href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`} fw={600}>
                {t('customers.card.call')}
              </Anchor>
            </Group>
          )
        }
        actions={<Button onClick={edit.open}>{t('customers.card.edit')}</Button>}
      />

      {customer.note && (
        <Card>
          <Text style={{ whiteSpace: 'pre-wrap' }}>{customer.note}</Text>
        </Card>
      )}

      <Stack gap="md">
        <SectionTitle>{t('customers.purchases.title')}</SectionTitle>
        <PurchaseHistory customerId={customer.id} />
      </Stack>

      <CustomerFormModal opened={editOpened} onClose={edit.close} customer={customer} />
    </PageContainer>
  )
}

function CustomerNotFound() {
  const { t } = useTranslation()
  return (
    <NotFoundState
      title={t('customers.notFound')}
      back={{ to: '/customers', label: t('customers.card.back') }}
    />
  )
}

function CustomerLoader({ id }: { id: number }) {
  const customer = useCustomer(id)

  if (customer.isPending) return <PageLoader />
  if (customer.isError) {
    if (isApiError(customer.error) && customer.error.status === 404) return <CustomerNotFound />
    return (
      <PageContainer>
        <QueryError error={customer.error} onRetry={() => customer.refetch()} />
      </PageContainer>
    )
  }
  return <CustomerDetails customer={customer.data} />
}

export function CustomerPage() {
  const id = parseId(useParams().id)
  if (id === null) return <CustomerNotFound />
  return <CustomerLoader key={id} id={id} />
}
