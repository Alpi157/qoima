import { Anchor, Button, Card, Group, Loader, Stack, Table, Text, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Link, useNavigate } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { QueryError } from '../../components/QueryError'
import { SearchInput } from '../../components/SearchInput'
import { useListParams } from '../../lib/useListParams'
import { type Customer, useCustomers } from './api'
import { CustomerFormModal } from './CustomerFormModal'

function CustomerTable({ items }: { items: Customer[] }) {
  const navigate = useNavigate()
  return (
    <Table.ScrollContainer minWidth={600} visibleFrom="sm">
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Имя</Table.Th>
            <Table.Th>Телефон</Table.Th>
            <Table.Th>Заметка</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((customer) => (
            <Table.Tr
              key={customer.id}
              onClick={() => navigate(`/customers/${customer.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <Table.Td>
                <Anchor
                  component={Link}
                  to={`/customers/${customer.id}`}
                  fw={600}
                  onClick={(event) => event.stopPropagation()}
                >
                  {customer.name}
                </Anchor>
              </Table.Td>
              <Table.Td style={{ whiteSpace: 'nowrap' }}>{customer.phone}</Table.Td>
              <Table.Td>
                <Text lineClamp={1}>{customer.note}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function CustomerCards({ items }: { items: Customer[] }) {
  return (
    <Stack gap="sm" hiddenFrom="sm">
      {items.map((customer) => (
        <Card
          key={customer.id}
          component={Link}
          to={`/customers/${customer.id}`}
          withBorder
          padding="sm"
          style={{ textDecoration: 'none' }}
        >
          <Text size="lg" fw={700}>
            {customer.name}
          </Text>
          {customer.phone && <Text>{customer.phone}</Text>}
          {customer.note && (
            <Text size="sm" c="dimmed" lineClamp={2}>
              {customer.note}
            </Text>
          )}
        </Card>
      ))}
    </Stack>
  )
}

export function CustomersPage() {
  const { q, page, setQ, setPage } = useListParams()
  const [formOpened, form] = useDisclosure()
  const customers = useCustomers({ q, page })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Покупатели</Title>
        <Button onClick={form.open}>Добавить покупателя</Button>
      </Group>

      <SearchInput
        value={q}
        onSearch={setQ}
        autoFocus
        placeholder="Имя или телефон"
        aria-label="Поиск покупателя"
      />

      {customers.isPending ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : customers.isError ? (
        <QueryError error={customers.error} onRetry={() => customers.refetch()} />
      ) : customers.data.items.length === 0 && page === 1 ? (
        q ? (
          <EmptyState text="Ничего не найдено" />
        ) : (
          <EmptyState
            text="Покупателей пока нет"
            actionLabel="Добавить первого покупателя"
            onAction={form.open}
          />
        )
      ) : (
        <>
          <Text c="dimmed" size="sm">
            Найдено: {customers.data.total}
          </Text>
          <CustomerTable items={customers.data.items} />
          <CustomerCards items={customers.data.items} />
          <ListPagination total={customers.data.total} page={page} onChange={setPage} />
        </>
      )}

      <CustomerFormModal opened={formOpened} onClose={form.close} />
    </Stack>
  )
}
