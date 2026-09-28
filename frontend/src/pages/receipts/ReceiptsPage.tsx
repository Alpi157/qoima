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
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { PeriodInput } from '../../components/PeriodInput'
import { QueryError } from '../../components/QueryError'
import { dateParam, formatDateTime } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { useListParams } from '../../lib/useListParams'
import { isReceiptStatus, type ReceiptListItem, useReceipts } from './api'
import { ReceiptStatusBadge } from './ReceiptStatusBadge'

const STATUS_OPTIONS = [
  { value: 'all', label: 'receipts.list.statusAll' },
  { value: 'posted', label: 'receipts.list.statusPosted' },
  { value: 'cancelled', label: 'receipts.list.statusCancelled' },
] as const

function costText(receipt: ReceiptListItem): string {
  return receipt.total_cost !== null ? formatMoney(receipt.total_cost) : '—'
}

function ReceiptTable({ items }: { items: ReceiptListItem[] }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  return (
    <Table.ScrollContainer minWidth={800} visibleFrom="sm">
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('receipts.list.number')}</Table.Th>
            <Table.Th>{t('receipts.list.date')}</Table.Th>
            <Table.Th>{t('receipts.list.supplier')}</Table.Th>
            <Table.Th ta="right">{t('receipts.list.positions')}</Table.Th>
            <Table.Th ta="right">{t('receipts.list.pieces')}</Table.Th>
            <Table.Th ta="right">{t('receipts.list.cost')}</Table.Th>
            <Table.Th>{t('receipts.list.status')}</Table.Th>
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
  const { t } = useTranslation()
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
            <Text fw={700}>{t('common.documentNumber', { number: receipt.number })}</Text>
            <ReceiptStatusBadge status={receipt.status} />
          </Group>
          <Text size="sm" c="dimmed">
            {formatDateTime(receipt.received_at)}
          </Text>
          {receipt.supplier && <Text>{receipt.supplier}</Text>}
          <Group justify="space-between" mt={4}>
            <Text size="sm">
              {t('receipts.list.cardCounts', {
                positions: receipt.lines_count,
                pieces: receipt.total_qty,
              })}
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
  const { t } = useTranslation()

  const isFiltered = Boolean(from || to || status)

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('receipts.list.title')}</Title>
        <Button component={Link} to="/receipts/new">
          {t('receipts.list.new')}
        </Button>
      </Group>

      <Group align="flex-end">
        <PeriodInput from={from} to={to} onChange={(from, to) => setParams({ from, to })} />
        <SegmentedControl
          aria-label={t('receipts.list.status')}
          data={STATUS_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))}
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
          <EmptyState text={t('common.nothingFound')} />
        ) : (
          <EmptyState
            text={t('receipts.list.empty')}
            actionLabel={t('receipts.list.addFirst')}
            onAction={() => navigate('/receipts/new')}
          />
        )
      ) : (
        <>
          <Text c="dimmed" size="sm">
            {t('common.found', { count: receipts.data.total })}
          </Text>
          <ReceiptTable items={receipts.data.items} />
          <ReceiptCards items={receipts.data.items} />
          <ListPagination total={receipts.data.total} page={page} onChange={setPage} />
        </>
      )}
    </Stack>
  )
}
