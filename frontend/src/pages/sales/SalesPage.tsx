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
  { value: 'all', label: 'Все' },
  { value: 'posted', label: 'Проведённые' },
  { value: 'cancelled', label: 'Отменённые' },
]

/** Cancelled sales stay in the list, but do not count and should not catch the eye. */
function rowColor(sale: SaleListItem): string | undefined {
  return sale.status === 'cancelled' ? 'dimmed' : undefined
}

function SaleTable({ items }: { items: SaleListItem[] }) {
  const navigate = useNavigate()
  return (
    <Table.ScrollContainer minWidth={800} visibleFrom="sm">
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>№</Table.Th>
            <Table.Th>Дата</Table.Th>
            <Table.Th>Покупатель</Table.Th>
            <Table.Th ta="right">Позиций</Table.Th>
            <Table.Th ta="right">Штук</Table.Th>
            <Table.Th ta="right">Сумма</Table.Th>
            <Table.Th>Статус</Table.Th>
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
              № {sale.number}
            </Text>
            <SaleStatusBadge status={sale.status} />
          </Group>
          <Text size="sm" c="dimmed">
            {formatDateTime(sale.sold_at)}
          </Text>
          {sale.customer_name && <Text inherit>{sale.customer_name}</Text>}
          <Group justify="space-between" mt={4}>
            <Text size="sm" inherit>
              Позиций: {sale.lines_count}, штук: {sale.total_qty}
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
  const fallbackName = customer.isError ? 'Покупатель не найден' : '…'
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

  const isFiltered = Boolean(from || to || status || customerId)

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Продажи</Title>
        <Button component={Link} to="/sale">
          Новая продажа
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
          aria-label="Статус"
          data={STATUS_OPTIONS}
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
          <EmptyState text="Ничего не найдено" />
        ) : (
          <EmptyState
            text="Продаж пока нет"
            actionLabel="Провести первую продажу"
            onAction={() => navigate('/sale')}
          />
        )
      ) : (
        <>
          <Paper withBorder p="md" radius="md">
            <Group justify="space-between" align="baseline">
              <Text fz={24} fw={700}>
                Итого за период: {formatMoney(sales.data.sum_posted)}
              </Text>
              <Text c="dimmed">Продаж: {sales.data.total}</Text>
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
