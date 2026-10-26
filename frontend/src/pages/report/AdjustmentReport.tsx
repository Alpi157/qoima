import { Button, Group, Stack, Text } from '@mantine/core'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ListPagination } from '../../components/ListPagination'
import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import { DataTable, RowLink } from '../../components/ui'
import { formatDateTime } from '../../lib/dates'
import { unitLabel } from '../../lib/labels'
import { formatInteger, formatMoney, formatRoundedMoney } from '../../lib/money'
import { useReportAdjustments, type AdjustmentDirection, type ReportAdjustment } from './api'

function AdjustmentList({
  from,
  to,
  direction,
}: {
  from: string
  to: string
  direction: AdjustmentDirection
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const query = useReportAdjustments(from, to, direction, page)
  const href = (row: ReportAdjustment) => `/products/${row.product_id}`
  const product = (row: ReportAdjustment) => (
    <Stack gap={0} style={{ overflowWrap: 'anywhere' }}>
      <RowLink to={href(row)}>{row.article}</RowLink>
      <Text c="dimmed" style={{ overflowWrap: 'anywhere' }}>
        {row.name}
      </Text>
    </Stack>
  )
  const quantity = (row: ReportAdjustment) => `${formatInteger(row.qty)} ${unitLabel(row.unit)}`
  const value = (row: ReportAdjustment) => (row.value === null ? '—' : formatMoney(row.value))
  if (query.isPending) return <PageLoader />
  if (query.isError) return <QueryError error={query.error} onRetry={() => query.refetch()} />
  return (
    <Stack gap="md">
      <DataTable
        rows={query.data.items}
        rowKey={(row) => row.movement_id}
        rowHref={href}
        mobileCardWithLinks
        columns={[
          { key: 'date', header: t('report.date'), cell: (row) => formatDateTime(row.created_at) },
          { key: 'product', header: t('report.adjustmentProduct'), cell: product },
          { key: 'qty', header: t('flow.qty'), numeric: true, cell: quantity },
          { key: 'value', header: t('report.adjustmentAmount'), numeric: true, cell: value },
          {
            key: 'reason',
            header: t('products.adjust.reason'),
            cell: (row) => <Text style={{ overflowWrap: 'anywhere' }}>{row.reason ?? '—'}</Text>,
          },
        ]}
        mobileCard={(row) => (
          <Stack gap="xs">
            <Text c="dimmed">{formatDateTime(row.created_at)}</Text>
            {product(row)}
            <Text>
              {t('flow.qty')}: {quantity(row)}
            </Text>
            <Text>
              {t('report.adjustmentAmount')}: {value(row)}
            </Text>
            <Text style={{ overflowWrap: 'anywhere' }}>
              {t('products.adjust.reason')}: {row.reason ?? '—'}
            </Text>
          </Stack>
        )}
      />
      <ListPagination total={query.data.total} page={page} onChange={setPage} />
    </Stack>
  )
}

export function AdjustmentReport({
  from,
  to,
  direction,
  amount,
}: {
  from: string
  to: string
  direction: AdjustmentDirection
  amount: number
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  return (
    <Stack gap="xs" data-testid={`report-adjustments-${direction}`}>
      <Group gap="xs">
        <Text>
          {t(direction === 'minus' ? 'report.writeOff' : 'report.surplus', {
            amount: formatRoundedMoney(amount),
          })}
        </Text>
        <Button
          variant="subtle"
          size="sm"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {t(expanded ? 'report.hideAdjustments' : 'report.showAdjustments')}
        </Button>
      </Group>
      {expanded && (
        <div id={id}>
          <AdjustmentList from={from} to={to} direction={direction} />
        </div>
      )}
    </Stack>
  )
}
