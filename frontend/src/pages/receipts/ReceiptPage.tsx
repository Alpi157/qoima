import { Anchor, Button, Group, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { isApiError } from '../../api/errors'
import { CancelDocumentModal } from '../../components/CancelDocumentModal'
import { CancelledNotice } from '../../components/CancelledNotice'
import { NotFoundState } from '../../components/NotFoundState'
import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import {
  Card,
  DataTable,
  type DataTableColumn,
  PageContainer,
  PageHeader,
} from '../../components/ui'
import { formatDateTime } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { parseId } from '../../lib/routeParams'
import { type Receipt, useCancelReceipt, useReceipt } from './api'
import { ReceiptStatusBadge } from './ReceiptStatusBadge'

type ReceiptLineOut = Receipt['lines'][number]

function money(tiyn: number | null): string {
  return tiyn !== null ? formatMoney(tiyn) : '—'
}

function lineSum(line: ReceiptLineOut): number | null {
  return line.unit_cost !== null ? line.unit_cost * line.qty : null
}

function ProductLink({ line }: { line: ReceiptLineOut }) {
  return (
    <Anchor component={Link} to={`/products/${line.product_id}`} fw={600}>
      {line.article}
    </Anchor>
  )
}

function LineCard({ line }: { line: ReceiptLineOut }) {
  return (
    <Stack gap="xs">
      <ProductLink line={line} />
      <Text>{line.name}</Text>
      <Group justify="space-between">
        <Text size="sm">
          {line.qty} × {money(line.unit_cost)}
        </Text>
        <Text fw={600}>{money(lineSum(line))}</Text>
      </Group>
    </Stack>
  )
}

function LinesTable({ lines }: { lines: ReceiptLineOut[] }) {
  const { t } = useTranslation()
  const columns: DataTableColumn<ReceiptLineOut>[] = [
    {
      key: 'article',
      header: t('receipts.lines.article'),
      nowrap: true,
      cell: (line) => <ProductLink line={line} />,
    },
    { key: 'name', header: t('receipts.lines.name'), cell: (line) => line.name },
    { key: 'qty', header: t('receipts.lines.qty'), numeric: true, cell: (line) => line.qty },
    {
      key: 'cost',
      header: t('receipts.lines.cost'),
      numeric: true,
      cell: (line) => money(line.unit_cost),
    },
    {
      key: 'sum',
      header: t('receipts.lines.sum'),
      numeric: true,
      cell: (line) => money(lineSum(line)),
    },
  ]
  return (
    <DataTable
      rows={lines}
      rowKey={(line) => line.product_id}
      columns={columns}
      mobileCard={(line) => <LineCard line={line} />}
    />
  )
}

function ReceiptDetails({ receipt }: { receipt: Receipt }) {
  const [cancelOpened, cancelModal] = useDisclosure()
  const cancel = useCancelReceipt(receipt.id)
  const { t } = useTranslation()

  return (
    <PageContainer>
      <PageHeader
        back={{ to: '/receipts', label: t('receipts.card.back') }}
        title={t('receipts.card.title', {
          number: receipt.number,
          date: formatDateTime(receipt.received_at),
        })}
        titleAside={<ReceiptStatusBadge status={receipt.status} />}
        subtitle={t('common.postedBy', {
          name: receipt.created_by_name,
          date: formatDateTime(receipt.created_at),
        })}
        actions={
          receipt.status === 'posted' && (
            <Button variant="default" c="red" onClick={cancelModal.open}>
              {t('receipts.cancel.confirm')}
            </Button>
          )
        }
      />

      {receipt.status === 'cancelled' && (
        <CancelledNotice title={t('receipts.card.cancelled')} document={receipt} />
      )}

      <Card>
        <Stack gap="xs">
          <Text>{t('receipts.card.supplier', { supplier: receipt.supplier ?? '—' })}</Text>
          {receipt.note && (
            <Text style={{ whiteSpace: 'pre-wrap' }}>
              {t('receipts.card.note', { note: receipt.note })}
            </Text>
          )}
        </Stack>
      </Card>

      <Stack gap="md">
        <LinesTable lines={receipt.lines} />
        <Card>
          <Group justify="space-between" gap="md">
            <Text>{t('receipts.card.positions', { count: receipt.lines.length })}</Text>
            <Text>{t('receipts.card.pieces', { count: receipt.total_qty })}</Text>
            <Text fw={600}>{t('receipts.card.cost', { amount: money(receipt.total_cost) })}</Text>
          </Group>
        </Card>
      </Stack>

      <CancelDocumentModal
        opened={cancelOpened}
        onClose={cancelModal.close}
        title={t('receipts.cancel.title', { number: receipt.number })}
        description={t('receipts.cancel.description')}
        confirmLabel={t('receipts.cancel.confirm')}
        cancel={cancel}
        successMessage={(saved) => t('receipts.cancel.done', { number: saved.number })}
      />
    </PageContainer>
  )
}

function ReceiptNotFound() {
  const { t } = useTranslation()
  return (
    <NotFoundState
      title={t('receipts.notFound')}
      back={{ to: '/receipts', label: t('receipts.card.back') }}
    />
  )
}

function ReceiptLoader({ id }: { id: number }) {
  const receipt = useReceipt(id)

  if (receipt.isPending) return <PageLoader />
  if (receipt.isError) {
    if (isApiError(receipt.error) && receipt.error.status === 404) return <ReceiptNotFound />
    return (
      <PageContainer>
        <QueryError error={receipt.error} onRetry={() => receipt.refetch()} />
      </PageContainer>
    )
  }
  return <ReceiptDetails receipt={receipt.data} />
}

export function ReceiptPage() {
  const id = parseId(useParams().id)
  if (id === null) return <ReceiptNotFound />
  return <ReceiptLoader key={id} id={id} />
}
