import { Button, Group, Loader, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { CustomerPicker, type PickedCustomer } from '../../components/CustomerPicker'
import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { PeriodInput } from '../../components/PeriodInput'
import { QueryError } from '../../components/QueryError'
import { StatusFilter } from '../../components/StatusFilter'
import {
  Card,
  DataTable,
  type DataTableColumn,
  PageContainer,
  PageHeader,
  RowLink,
  Stat,
  useBackToMore,
} from '../../components/ui'
import { dateParam, formatDateTime } from '../../lib/dates'
import { formatAmount, formatMoney } from '../../lib/money'
import { parseId } from '../../lib/routeParams'
import { useListParams } from '../../lib/useListParams'
import { useCustomer } from '../customers/api'
import { isSaleStatus, type SaleListItem, useSales } from './api'
import { SaleStatusBadge } from './SaleStatusBadge'

const STATUS_OPTIONS = [
  { value: 'all', label: 'sales.list.statusAll' },
  { value: 'posted', label: 'sales.list.statusPosted' },
  { value: 'cancelled', label: 'sales.list.statusCancelled' },
] as const

const salePath = (sale: SaleListItem) => `/sales/${sale.id}`
// Cancelled sales stay in the list, but do not count and should not catch the eye.
const isCancelled = (sale: SaleListItem) => sale.status === 'cancelled'

function SaleCard({ sale }: { sale: SaleListItem }) {
  const { t } = useTranslation()
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={600} inherit>
          {t('common.documentNumber', { number: sale.number })}
        </Text>
        <SaleStatusBadge status={sale.status} />
      </Group>
      <Text size="sm" c="dimmed">
        {formatDateTime(sale.sold_at)}
      </Text>
      {sale.customer_name && <Text inherit>{sale.customer_name}</Text>}
      <Group justify="space-between">
        <Text size="sm" inherit>
          {t('sales.list.cardCounts', { positions: sale.lines_count, pieces: sale.total_qty })}
        </Text>
        <Text fw={600} inherit>
          {formatMoney(sale.total)}
        </Text>
      </Group>
    </Stack>
  )
}

function SaleTable({ items }: { items: SaleListItem[] }) {
  const { t } = useTranslation()
  const columns: DataTableColumn<SaleListItem>[] = [
    {
      key: 'number',
      header: t('sales.list.number'),
      nowrap: true,
      cell: (sale) => <RowLink to={salePath(sale)}>{sale.number}</RowLink>,
    },
    {
      key: 'date',
      header: t('sales.list.date'),
      nowrap: true,
      cell: (sale) => formatDateTime(sale.sold_at),
    },
    {
      key: 'customer',
      header: t('sales.list.customer'),
      cell: (sale) => sale.customer_name ?? '—',
    },
    {
      key: 'positions',
      header: t('sales.list.positions'),
      numeric: true,
      cell: (sale) => sale.lines_count,
    },
    {
      key: 'pieces',
      header: t('sales.list.pieces'),
      numeric: true,
      cell: (sale) => sale.total_qty,
    },
    {
      key: 'total',
      header: t('sales.list.total'),
      numeric: true,
      cell: (sale) => formatMoney(sale.total),
    },
    {
      key: 'status',
      header: t('sales.list.status'),
      cell: (sale) => <SaleStatusBadge status={sale.status} />,
    },
  ]
  return (
    <DataTable
      rows={items}
      rowKey={(sale) => sale.id}
      columns={columns}
      rowHref={salePath}
      dimmed={isCancelled}
      minWidth={900}
      mobileCard={(sale) => <SaleCard sale={sale} />}
    />
  )
}

interface CustomerFilterProps {
  customerId: number | null
  onChange: (customer: PickedCustomer | null) => void
}

/** The address keeps only the customer's id; the plate needs the name. */
function ChosenCustomerFilter({
  customerId,
  onChange,
}: CustomerFilterProps & { customerId: number }) {
  const customer = useCustomer(customerId)
  const { t } = useTranslation()
  const fallbackName = customer.isError ? t('customers.notFound') : '…'
  const value = customer.data ?? { id: customerId, name: fallbackName, phone: null }
  return <CustomerPicker value={value} onChange={onChange} allowCreate={false} />
}

function CustomerFilter({ customerId, onChange }: CustomerFilterProps) {
  return (
    <div style={{ flex: '0 1 480px', minWidth: 0 }}>
      {customerId === null ? (
        <CustomerPicker value={null} onChange={onChange} allowCreate={false} />
      ) : (
        <ChosenCustomerFilter customerId={customerId} onChange={onChange} />
      )}
    </div>
  )
}

export function SalesPage() {
  const { page, searchParams, setPage, setParam, setParams } = useListParams()
  const from = dateParam(searchParams.get('from'))
  const to = dateParam(searchParams.get('to'))
  const customerId = parseId(searchParams.get('customer') ?? undefined)
  const rawStatus = searchParams.get('status') ?? ''
  const status = isSaleStatus(rawStatus) ? rawStatus : ''
  const sales = useSales({ from, to, customerId: customerId ?? undefined, status, page })
  const navigate = useNavigate()
  const { t } = useTranslation()
  const backToMore = useBackToMore()

  const isFiltered = Boolean(from || to || status || customerId)

  return (
    <PageContainer>
      <PageHeader
        back={backToMore}
        title={t('sales.list.title')}
        actions={
          <Button component={Link} to="/sell">
            {t('sales.list.new')}
          </Button>
        }
      />

      <Stack gap="md">
        <PeriodInput
          from={from}
          to={to}
          onChange={(from, to) => setParams({ from, to })}
          withQuickRanges
        />
        <Group align="flex-end" gap="md">
          <CustomerFilter
            customerId={customerId}
            onChange={(customer) => setParam('customer', customer ? String(customer.id) : null)}
          />
          <StatusFilter
            label={t('sales.list.status')}
            options={STATUS_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))}
            value={status || 'all'}
            onChange={(value) => setParam('status', value === 'all' ? null : value)}
          />
        </Group>
      </Stack>

      {sales.isPending ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : sales.isError ? (
        <QueryError error={sales.error} onRetry={() => sales.refetch()} />
      ) : sales.data.items.length === 0 && page === 1 ? (
        isFiltered ? (
          <EmptyState text={t('common.nothingFound')} />
        ) : (
          <EmptyState
            text={t('sales.list.empty')}
            actionLabel={t('sales.list.addFirst')}
            onAction={() => navigate('/sell')}
          />
        )
      ) : (
        <Stack gap="md">
          <Card>
            <Group justify="space-between" align="flex-end" gap="md">
              <Stat
                label={t('sales.list.periodTotal')}
                value={formatAmount(sales.data.sum_posted)}
                unit="₸"
              />
              <Text c="dimmed">{t('sales.list.count', { count: sales.data.total })}</Text>
            </Group>
          </Card>
          <SaleTable items={sales.data.items} />
          <ListPagination total={sales.data.total} page={page} onChange={setPage} />
        </Stack>
      )}
    </PageContainer>
  )
}
