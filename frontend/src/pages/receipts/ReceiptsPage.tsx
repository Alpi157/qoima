import {
  Anchor,
  Button,
  Card,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { QueryError } from '../../components/QueryError'
import { formatDateTime } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { useListParams } from '../../lib/useListParams'
import { isReceiptStatus, type ReceiptListItem, useReceipts } from './api'
import { ReceiptStatusBadge } from './ReceiptStatusBadge'

const STATUS_OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'posted', label: 'Проведённые' },
  { value: 'cancelled', label: 'Отменённые' },
]

type DateRange = [string | null, string | null]

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** A date from the address, "2026-09-27"; anything else is ignored instead of failing the list. */
function dateParam(value: string | null): string {
  return value && DATE_PATTERN.test(value) ? value : ''
}

function costText(receipt: ReceiptListItem): string {
  return receipt.total_cost !== null ? formatMoney(receipt.total_cost) : '—'
}

function ReceiptTable({ items }: { items: ReceiptListItem[] }) {
  const navigate = useNavigate()
  return (
    <Table.ScrollContainer minWidth={800} visibleFrom="sm">
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>№</Table.Th>
            <Table.Th>Дата</Table.Th>
            <Table.Th>Поставщик</Table.Th>
            <Table.Th ta="right">Позиций</Table.Th>
            <Table.Th ta="right">Штук</Table.Th>
            <Table.Th ta="right">Сумма закупки</Table.Th>
            <Table.Th>Статус</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((receipt) => (
            <Table.Tr
              key={receipt.id}
              onClick={() => navigate(`/receipts/${receipt.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <Table.Td>
                <Anchor
                  component={Link}
                  to={`/receipts/${receipt.id}`}
                  fw={600}
                  onClick={(event) => event.stopPropagation()}
                >
                  {receipt.number}
                </Anchor>
              </Table.Td>
              <Table.Td style={{ whiteSpace: 'nowrap' }}>
                {formatDateTime(receipt.received_at)}
              </Table.Td>
              <Table.Td>{receipt.supplier ?? '—'}</Table.Td>
              <Table.Td ta="right">{receipt.lines_count}</Table.Td>
              <Table.Td ta="right">{receipt.total_qty}</Table.Td>
              <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                {costText(receipt)}
              </Table.Td>
              <Table.Td>
                <ReceiptStatusBadge status={receipt.status} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function ReceiptCards({ items }: { items: ReceiptListItem[] }) {
  return (
    <Stack gap="sm" hiddenFrom="sm">
      {items.map((receipt) => (
        <Card
          key={receipt.id}
          component={Link}
          to={`/receipts/${receipt.id}`}
          withBorder
          padding="sm"
          style={{ textDecoration: 'none' }}
        >
          <Group justify="space-between" wrap="nowrap">
            <Text fw={700}>№ {receipt.number}</Text>
            <ReceiptStatusBadge status={receipt.status} />
          </Group>
          <Text size="sm" c="dimmed">
            {formatDateTime(receipt.received_at)}
          </Text>
          {receipt.supplier && <Text>{receipt.supplier}</Text>}
          <Group justify="space-between" mt={4}>
            <Text size="sm">
              Позиций: {receipt.lines_count}, штук: {receipt.total_qty}
            </Text>
            <Text fw={500}>{costText(receipt)}</Text>
          </Group>
        </Card>
      ))}
    </Stack>
  )
}

export function ReceiptsPage() {
  const { page, searchParams, setPage, setParam, setParams } = useListParams()
  const from = dateParam(searchParams.get('from'))
  const to = dateParam(searchParams.get('to'))
  const rawStatus = searchParams.get('status') ?? ''
  const status = isReceiptStatus(rawStatus) ? rawStatus : ''
  const receipts = useReceipts({ from, to, status, page })
  const navigate = useNavigate()

  // The first click of a range picks only its start; the address changes once both ends are set.
  const [draftRange, setDraftRange] = useState<DateRange | null>(null)
  const range: DateRange = draftRange ?? [from || null, to || null]

  const changeRange = (value: DateRange) => {
    if (value[0] && !value[1]) {
      setDraftRange(value)
      return
    }
    setDraftRange(null)
    setParams({ from: value[0], to: value[1] })
  }

  const isFiltered = Boolean(from || to || status)

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Приходы</Title>
        <Button component={Link} to="/receipts/new">
          Новый приход
        </Button>
      </Group>

      <Group align="flex-end">
        <DatePickerInput
          type="range"
          label="Период"
          placeholder="Все даты"
          valueFormat="DD.MM.YYYY"
          allowSingleDateInRange
          clearable
          value={range}
          onChange={changeRange}
          miw={260}
        />
        <SegmentedControl
          aria-label="Статус"
          data={STATUS_OPTIONS}
          value={status || 'all'}
          onChange={(value) => setParam('status', value === 'all' ? null : value)}
        />
      </Group>

      {receipts.isPending ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : receipts.isError ? (
        <QueryError error={receipts.error} onRetry={() => receipts.refetch()} />
      ) : receipts.data.items.length === 0 && page === 1 ? (
        isFiltered ? (
          <EmptyState text="Ничего не найдено" />
        ) : (
          <EmptyState
            text="Приходов пока нет"
            actionLabel="Провести первый приход"
            onAction={() => navigate('/receipts/new')}
          />
        )
      ) : (
        <>
          <Text c="dimmed" size="sm">
            Найдено: {receipts.data.total}
          </Text>
          <ReceiptTable items={receipts.data.items} />
          <ReceiptCards items={receipts.data.items} />
          <ListPagination total={receipts.data.total} page={page} onChange={setPage} />
        </>
      )}
    </Stack>
  )
}
