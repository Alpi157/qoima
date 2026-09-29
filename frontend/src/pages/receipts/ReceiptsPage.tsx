import { Button, Group, Loader, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { PeriodInput } from '../../components/PeriodInput'
import { QueryError } from '../../components/QueryError'
import { StatusFilter } from '../../components/StatusFilter'
import {
  DataTable,
  type DataTableColumn,
  PageContainer,
  PageHeader,
  RowLink,
  useBackToMore,
} from '../../components/ui'
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

const receiptPath = (receipt: ReceiptListItem) => `/receipts/${receipt.id}`

function ReceiptCard({ receipt }: { receipt: ReceiptListItem }) {
  const { t } = useTranslation()
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={600} inherit>
          {t('common.documentNumber', { number: receipt.number })}
        </Text>
        <ReceiptStatusBadge status={receipt.status} />
      </Group>
      <Text size="sm" c="dimmed">
        {formatDateTime(receipt.received_at)}
      </Text>
      {receipt.supplier && <Text inherit>{receipt.supplier}</Text>}
      <Group justify="space-between">
        <Text size="sm" inherit>
          {t('receipts.list.cardCounts', {
            positions: receipt.lines_count,
            pieces: receipt.total_qty,
          })}
        </Text>
        <Text fw={600} inherit>
          {costText(receipt)}
        </Text>
      </Group>
    </Stack>
  )
}

function ReceiptTable({ items }: { items: ReceiptListItem[] }) {
  const { t } = useTranslation()
  const columns: DataTableColumn<ReceiptListItem>[] = [
    {
      key: 'number',
      header: t('receipts.list.number'),
      nowrap: true,
      cell: (receipt) => <RowLink to={receiptPath(receipt)}>{receipt.number}</RowLink>,
    },
    {
      key: 'date',
      header: t('receipts.list.date'),
      nowrap: true,
      cell: (receipt) => formatDateTime(receipt.received_at),
    },
    {
      key: 'supplier',
      header: t('receipts.list.supplier'),
      cell: (receipt) => receipt.supplier ?? '—',
    },
    {
      key: 'positions',
      header: t('receipts.list.positions'),
      numeric: true,
      cell: (receipt) => receipt.lines_count,
    },
    {
      key: 'pieces',
      header: t('receipts.list.pieces'),
      numeric: true,
      cell: (receipt) => receipt.total_qty,
    },
    { key: 'cost', header: t('receipts.list.cost'), numeric: true, cell: costText },
    {
      key: 'status',
      header: t('receipts.list.status'),
      cell: (receipt) => <ReceiptStatusBadge status={receipt.status} />,
    },
  ]
  return (
    <DataTable
      rows={items}
      rowKey={(receipt) => receipt.id}
      columns={columns}
      rowHref={receiptPath}
      dimmed={(receipt) => receipt.status === 'cancelled'}
      minWidth={900}
      mobileCard={(receipt) => <ReceiptCard receipt={receipt} />}
    />
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
  const backToMore = useBackToMore()

  const isFiltered = Boolean(from || to || status)

  return (
    <PageContainer>
      <PageHeader
        back={backToMore}
        title={t('receipts.list.title')}
        actions={
          <Button component={Link} to="/receive">
            {t('receipts.list.new')}
          </Button>
        }
      />

      <Group align="flex-end" gap="md">
        <PeriodInput from={from} to={to} onChange={(from, to) => setParams({ from, to })} />
        <StatusFilter
          label={t('receipts.list.status')}
          options={STATUS_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))}
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
            onAction={() => navigate('/receive')}
          />
        )
      ) : (
        <Stack gap="md">
          <Text c="dimmed" size="sm">
            {t('common.found', { count: receipts.data.total })}
          </Text>
          <ReceiptTable items={receipts.data.items} />
          <ListPagination total={receipts.data.total} page={page} onChange={setPage} />
        </Stack>
      )}
    </PageContainer>
  )
}
