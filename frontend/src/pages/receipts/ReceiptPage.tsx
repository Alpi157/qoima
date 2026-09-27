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
  return (
    <Table.ScrollContainer minWidth={600} visibleFrom="sm">
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Артикул</Table.Th>
            <Table.Th>Наименование</Table.Th>
            <Table.Th ta="right">Количество</Table.Th>
            <Table.Th ta="right">Цена</Table.Th>
            <Table.Th ta="right">Сумма</Table.Th>
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

  return (
    <Stack>
      <Anchor component={Link} to="/receipts" size="sm">
        ← Приходы
      </Anchor>

      <Group justify="space-between" align="flex-start">
        <Group gap="sm">
          <Title order={2}>
            Приход №{receipt.number} от {formatDateTime(receipt.received_at)}
          </Title>
          <ReceiptStatusBadge status={receipt.status} />
        </Group>
        {receipt.status === 'posted' && (
          <Button color="red" variant="light" onClick={cancelModal.open}>
            Отменить приход
          </Button>
        )}
      </Group>

      {receipt.status === 'cancelled' && (
        <Alert color="red" title="Приход отменён">
          {receipt.cancelled_at && (
            <Text size="sm">Когда: {formatDateTime(receipt.cancelled_at)}</Text>
          )}
          {receipt.cancelled_by_name && <Text size="sm">Кто: {receipt.cancelled_by_name}</Text>}
          {receipt.cancel_reason && <Text size="sm">Причина: {receipt.cancel_reason}</Text>}
        </Alert>
      )}

      <Stack gap={4}>
        <Text>Поставщик: {receipt.supplier ?? '—'}</Text>
        {receipt.note && <Text style={{ whiteSpace: 'pre-wrap' }}>Заметка: {receipt.note}</Text>}
        <Text c="dimmed" size="sm">
          Провёл: {receipt.created_by_name}, {formatDateTime(receipt.created_at)}
        </Text>
      </Stack>

      <LinesTable lines={receipt.lines} />
      <LinesCards lines={receipt.lines} />

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between">
          <Text>Позиций: {receipt.lines.length}</Text>
          <Text>Штук: {receipt.total_qty}</Text>
          <Text fw={600}>Сумма закупки: {money(receipt.total_cost)}</Text>
        </Group>
      </Paper>

      <CancelDocumentModal
        opened={cancelOpened}
        onClose={cancelModal.close}
        title={`Отменить приход №${receipt.number}?`}
        description="Остатки товаров из прихода уменьшатся обратно. Сам приход останется в списке как отменённый."
        confirmLabel="Отменить приход"
        cancel={cancel}
        successMessage={(saved) => `Приход №${saved.number} отменён`}
      />
    </Stack>
  )
}

function ReceiptNotFound() {
  return <NotFoundState title="Приход не найден" backTo="/receipts" backLabel="К списку приходов" />
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
