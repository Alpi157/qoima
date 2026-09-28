import {
  Anchor,
  Button,
  Card,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { CustomerPicker, type PickedCustomer } from '../../components/CustomerPicker'
import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { PeriodInput } from '../../components/PeriodInput'
import { QueryError } from '../../components/QueryError'
import { dateParam, formatDateTime } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
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

/** Cancelled sales stay in the list, but do not count and should not catch the eye. */
function rowColor(sale: SaleListItem): string | undefined {
  return sale.status === 'cancelled' ? 'dimmed' : undefined
}

function SaleTable({ items }: { items: SaleListItem[] }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  return (
    <Table.ScrollContainer minWidth={800} visibleFrom="sm">
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('sales.list.number')}</Table.Th>
            <Table.Th>{t('sales.list.date')}</Table.Th>
            <Table.Th>{t('sales.list.customer')}</Table.Th>
            <Table.Th ta="right">{t('sales.list.positions')}</Table.Th>
            <Table.Th ta="right">{t('sales.list.pieces')}</Table.Th>
            <Table.Th ta="right">{t('sales.list.total')}</Table.Th>
            <Table.Th>{t('sales.list.status')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((sale) => (
            <Table.Tr
              key={sale.id}
              c={rowColor(sale)}
              onClick={() => navigate(`/sales/${sale.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <Table.Td>
                <Anchor
                  component={Link}
                  to={`/sales/${sale.id}`}
                  fw={600}
                  c={rowColor(sale)}
                  onClick={(event) => event.stopPropagation()}
                >
                  {sale.number}
                </Anchor>
              </Table.Td>
              <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(sale.sold_at)}</Table.Td>
              <Table.Td>{sale.customer_name ?? '—'}</Table.Td>
              <Table.Td ta="right">{sale.lines_count}</Table.Td>
              <Table.Td ta="right">{sale.total_qty}</Table.Td>
              <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                {formatMoney(sale.total)}
              </Table.Td>
              <Table.Td>
                <SaleStatusBadge status={sale.status} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function SaleCards({ items }: { items: SaleListItem[] }) {
  const { t } = useTranslation()
  return (
    <Stack gap="sm" hiddenFrom="sm">
      {items.map((sale) => (
        <Card
          key={sale.id}
          component={Link}
          to={`/sales/${sale.id}`}
          withBorder
          padding="sm"
          c={rowColor(sale)}
          style={{ textDecoration: 'none' }}
        >
          <Group justify="space-between" wrap="nowrap">
            <Text fw={700} inherit>
              {t('common.documentNumber', { number: sale.number })}
            </Text>
            <SaleStatusBadge status={sale.status} />
          </Group>
          <Text size="sm" c="dimmed">
            {formatDateTime(sale.sold_at)}
          </Text>
          {sale.customer_name && <Text inherit>{sale.customer_name}</Text>}
          <Group justify="space-between" mt={4}>
            <Text size="sm" inherit>
              {t('sales.list.cardCounts', { positions: sale.lines_count, pieces: sale.total_qty })}
            </Text>
            <Text fw={500} inherit>
              {formatMoney(sale.total)}
            </Text>
          </Group>
        </Card>
      ))}
    </Stack>
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
    <div style={{ minWidth: 240 }}>
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

  const isFiltered = Boolean(from || to || status || customerId)

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('sales.list.title')}</Title>
        <Button component={Link} to="/sale">
          {t('sales.list.new')}
        </Button>
      </Group>

      <Group align="flex-end">
        <PeriodInput
          from={from}
          to={to}
          onChange={(from, to) => setParams({ from, to })}
          withQuickRanges
        />
        <CustomerFilter
          customerId={customerId}
          onChange={(customer) => setParam('customer', customer ? String(customer.id) : null)}
        />
        <SegmentedControl
          aria-label={t('sales.list.status')}
          data={STATUS_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))}
          value={status || 'all'}
          onChange={(value) => setParam('status', value === 'all' ? null : value)}
        />
      </Group>

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
            onAction={() => navigate('/sale')}
          />
        )
      ) : (
        <>
          <Paper withBorder p="md" radius="md">
            <Group justify="space-between" align="baseline">
              <Text fz={24} fw={700}>
                {t('sales.list.periodTotal', { amount: formatMoney(sales.data.sum_posted) })}
              </Text>
              <Text c="dimmed">{t('sales.list.count', { count: sales.data.total })}</Text>
            </Group>
          </Paper>
          <SaleTable items={sales.data.items} />
          <SaleCards items={sales.data.items} />
          <ListPagination total={sales.data.total} page={page} onChange={setPage} />
        </>
      )}
    </Stack>
  )
}
