import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  Loader,
  Paper,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { isApiError } from '../../api/errors'
import { CancelDocumentModal } from '../../components/CancelDocumentModal'
import { NotFoundState } from '../../components/NotFoundState'
import { QueryError } from '../../components/QueryError'
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

function LinesTable({ lines }: { lines: ReceiptLineOut[] }) {
  const { t } = useTranslation()
  return (
    <Table.ScrollContainer minWidth={600} visibleFrom="sm">
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('receipts.lines.article')}</Table.Th>
            <Table.Th>{t('receipts.lines.name')}</Table.Th>
            <Table.Th ta="right">{t('receipts.lines.qty')}</Table.Th>
            <Table.Th ta="right">{t('receipts.lines.cost')}</Table.Th>
            <Table.Th ta="right">{t('receipts.lines.sum')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {lines.map((line) => (
            <Table.Tr key={line.product_id}>
              <Table.Td>
                <ProductLink line={line} />
              </Table.Td>
              <Table.Td>{line.name}</Table.Td>
              <Table.Td ta="right">{line.qty}</Table.Td>
              <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                {money(line.unit_cost)}
              </Table.Td>
              <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                {money(lineSum(line))}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function LinesCards({ lines }: { lines: ReceiptLineOut[] }) {
  return (
    <Stack gap="sm" hiddenFrom="sm">
      {lines.map((line) => (
        <Card key={line.product_id} withBorder padding="sm">
          <ProductLink line={line} />
          <Text>{line.name}</Text>
          <Group justify="space-between">
            <Text size="sm">
              {line.qty} × {money(line.unit_cost)}
            </Text>
            <Text fw={500}>{money(lineSum(line))}</Text>
          </Group>
        </Card>
      ))}
    </Stack>
  )
}

function ReceiptDetails({ receipt }: { receipt: Receipt }) {
  const [cancelOpened, cancelModal] = useDisclosure()
  const cancel = useCancelReceipt(receipt.id)
  const { t } = useTranslation()

  return (
    <Stack>
      <Anchor component={Link} to="/receipts" size="sm">
        {t('receipts.card.back')}
      </Anchor>

      <Group justify="space-between" align="flex-start">
        <Group gap="sm">
          <Title order={2}>
            {t('receipts.card.title', {
              number: receipt.number,
              date: formatDateTime(receipt.received_at),
            })}
          </Title>
          <ReceiptStatusBadge status={receipt.status} />
        </Group>
        {receipt.status === 'posted' && (
          <Button color="red" variant="light" onClick={cancelModal.open}>
            {t('receipts.cancel.confirm')}
          </Button>
        )}
      </Group>

      {receipt.status === 'cancelled' && (
        <Alert color="red" title={t('receipts.card.cancelled')}>
          {receipt.cancelled_at && (
            <Text size="sm">
              {t('common.cancelled.when', { date: formatDateTime(receipt.cancelled_at) })}
            </Text>
          )}
          {receipt.cancelled_by_name && (
            <Text size="sm">{t('common.cancelled.who', { name: receipt.cancelled_by_name })}</Text>
          )}
          {receipt.cancel_reason && (
            <Text size="sm">{t('common.cancelled.reason', { reason: receipt.cancel_reason })}</Text>
          )}
        </Alert>
      )}

      <Stack gap={4}>
        <Text>{t('receipts.card.supplier', { supplier: receipt.supplier ?? '—' })}</Text>
        {receipt.note && (
          <Text style={{ whiteSpace: 'pre-wrap' }}>
            {t('receipts.card.note', { note: receipt.note })}
          </Text>
        )}
        <Text c="dimmed" size="sm">
          {t('common.postedBy', {
            name: receipt.created_by_name,
            date: formatDateTime(receipt.created_at),
          })}
        </Text>
      </Stack>

      <LinesTable lines={receipt.lines} />
      <LinesCards lines={receipt.lines} />

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between">
          <Text>{t('receipts.card.positions', { count: receipt.lines.length })}</Text>
          <Text>{t('receipts.card.pieces', { count: receipt.total_qty })}</Text>
          <Text fw={600}>{t('receipts.card.cost', { amount: money(receipt.total_cost) })}</Text>
        </Group>
      </Paper>

      <CancelDocumentModal
        opened={cancelOpened}
        onClose={cancelModal.close}
        title={t('receipts.cancel.title', { number: receipt.number })}
        description={t('receipts.cancel.description')}
        confirmLabel={t('receipts.cancel.confirm')}
        cancel={cancel}
        successMessage={(saved) => t('receipts.cancel.done', { number: saved.number })}
      />
    </Stack>
  )
}

function ReceiptNotFound() {
  const { t } = useTranslation()
  return (
    <NotFoundState
      title={t('receipts.notFound')}
      backTo="/receipts"
      backLabel={t('receipts.backToList')}
    />
  )
}

function ReceiptLoader({ id }: { id: number }) {
  const receipt = useReceipt(id)

  if (receipt.isPending) return <Loader />
  if (receipt.isError) {
    if (isApiError(receipt.error) && receipt.error.status === 404) return <ReceiptNotFound />
    return <QueryError error={receipt.error} onRetry={() => receipt.refetch()} />
  }
  return <ReceiptDetails receipt={receipt.data} />
}

export function ReceiptPage() {
  const id = parseId(useParams().id)
  if (id === null) return <ReceiptNotFound />
  return <ReceiptLoader key={id} id={id} />
}
