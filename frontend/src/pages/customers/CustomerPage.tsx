import {
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Link, useParams } from 'react-router-dom'

import { isApiError } from '../../api/errors'
import { ListPagination } from '../../components/ListPagination'
import { NotFoundState } from '../../components/NotFoundState'
import { QueryError } from '../../components/QueryError'
import { formatDateTime } from '../../lib/dates'
import { saleStatusLabel } from '../../lib/labels'
import { formatMoney } from '../../lib/money'
import { parseId } from '../../lib/routeParams'
import { useListParams } from '../../lib/useListParams'
import { type Customer, type SaleListItem, useCustomer, useSales } from './api'
import { CustomerFormModal } from './CustomerFormModal'

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge color={status === 'cancelled' ? 'gray' : 'green'} variant="light">
      {saleStatusLabel(status)}
    </Badge>
  )
}

function SaleLink({ sale }: { sale: SaleListItem }) {
  return (
    <Anchor component={Link} to={`/sales/${sale.id}`} fw={600}>
      № {sale.number}
    </Anchor>
  )
}

function SaleTable({ items }: { items: SaleListItem[] }) {
  return (
    <Table.ScrollContainer minWidth={500} visibleFrom="sm">
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>№</Table.Th>
            <Table.Th>Дата</Table.Th>
            <Table.Th ta="right">Сумма</Table.Th>
            <Table.Th>Статус</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((sale) => (
            <Table.Tr key={sale.id}>
              <Table.Td>
                <SaleLink sale={sale} />
              </Table.Td>
              <Table.Td>{formatDateTime(sale.sold_at)}</Table.Td>
              <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                {formatMoney(sale.total)}
              </Table.Td>
              <Table.Td>
                <StatusBadge status={sale.status} />
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
        <Card key={sale.id} withBorder padding="sm">
          <Group justify="space-between">
            <SaleLink sale={sale} />
            <StatusBadge status={sale.status} />
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {formatDateTime(sale.sold_at)}
            </Text>
            <Text fw={600}>{formatMoney(sale.total)}</Text>
          </Group>
        </Card>
      ))}
    </Stack>
  )
}

function PurchaseHistory({ customerId }: { customerId: number }) {
  const { page, setPage } = useListParams()
  const sales = useSales({ customerId, page })

  if (sales.isPending) return <Loader />
  if (sales.isError) return <QueryError error={sales.error} onRetry={() => sales.refetch()} />
  if (sales.data.total === 0) return <Text c="dimmed">Покупок пока не было</Text>
  return (
    <Stack>
      <Text fw={600}>Всего покупок на {formatMoney(sales.data.sum_posted)}</Text>
      <SaleTable items={sales.data.items} />
      <SaleCards items={sales.data.items} />
      <ListPagination total={sales.data.total} page={page} onChange={setPage} />
    </Stack>
  )
}

function CustomerDetails({ customer }: { customer: Customer }) {
  const [editOpened, edit] = useDisclosure()

  return (
    <Stack>
      <Anchor component={Link} to="/customers" size="sm">
        ← Покупатели
      </Anchor>

      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={2}>{customer.name}</Title>
          {customer.phone && (
            <Group gap="xs">
              <Text size="lg">{customer.phone}</Text>
              <Anchor href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`} size="sm">
                Позвонить
              </Anchor>
            </Group>
          )}
          {customer.note && <Text style={{ whiteSpace: 'pre-wrap' }}>{customer.note}</Text>}
        </Stack>
        <Button onClick={edit.open}>Изменить</Button>
      </Group>

      <Title order={3} mt="md">
        История покупок
      </Title>
      <PurchaseHistory customerId={customer.id} />

      <CustomerFormModal opened={editOpened} onClose={edit.close} customer={customer} />
    </Stack>
  )
}

function CustomerNotFound() {
  return (
    <NotFoundState
      title="Покупатель не найден"
      backTo="/customers"
      backLabel="К списку покупателей"
    />
  )
}

function CustomerLoader({ id }: { id: number }) {
  const customer = useCustomer(id)

  if (customer.isPending) return <Loader />
  if (customer.isError) {
    if (isApiError(customer.error) && customer.error.status === 404) return <CustomerNotFound />
    return <QueryError error={customer.error} onRetry={() => customer.refetch()} />
  }
  return <CustomerDetails customer={customer.data} />
}

export function CustomerPage() {
  const id = parseId(useParams().id)
  if (id === null) return <CustomerNotFound />
  return <CustomerLoader key={id} id={id} />
}
