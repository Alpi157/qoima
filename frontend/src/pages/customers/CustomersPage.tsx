import { Anchor, Button, Card, Group, Loader, Stack, Table, Text, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  return (
    <Table.ScrollContainer minWidth={600} visibleFrom="sm">
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('customers.list.name')}</Table.Th>
            <Table.Th>{t('customers.list.phone')}</Table.Th>
            <Table.Th>{t('customers.list.note')}</Table.Th>
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
  const { t } = useTranslation()

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('customers.list.title')}</Title>
        <Button onClick={form.open}>{t('customers.list.add')}</Button>
      </Group>

      <SearchInput
        value={q}
        onSearch={setQ}
        autoFocus
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
        <>
          <Text c="dimmed" size="sm">
            {t('common.found', { count: customers.data.total })}
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
