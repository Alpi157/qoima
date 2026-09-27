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
import { type Sale, useCancelSale, useSale } from './api'
import { SaleStatusBadge } from './SaleStatusBadge'

type SaleLineOut = Sale['lines'][number]

function ProductLink({ line }: { line: SaleLineOut }) {
  return (
    <Anchor component={Link} to={`/products/${line.product_id}`} fw={600}>
      {line.article}
    </Anchor>
  )
}

function LinesTable({ lines }: { lines: SaleLineOut[] }) {
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
              <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                {line.qty} {line.unit}
              </Table.Td>
              <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                {formatMoney(line.unit_price)}
              </Table.Td>
              <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                {formatMoney(line.line_total)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function LinesCards({ lines }: { lines: SaleLineOut[] }) {
  return (
    <Stack gap="sm" hiddenFrom="sm">
      {lines.map((line) => (
        <Card key={line.product_id} withBorder padding="sm">
          <ProductLink line={line} />
          <Text>{line.name}</Text>
          <Group justify="space-between">
            <Text size="sm">
              {line.qty} {line.unit} × {formatMoney(line.unit_price)}
            </Text>
            <Text fw={500}>{formatMoney(line.line_total)}</Text>
          </Group>
        </Card>
      ))}
    </Stack>
  )
}

function SaleDetails({ sale }: { sale: Sale }) {
  const [cancelOpened, cancelModal] = useDisclosure()
  const cancel = useCancelSale(sale.id)

  return (
    <Stack>
      <Anchor component={Link} to="/sales" size="sm">
        ← Продажи
      </Anchor>

      <Group justify="space-between" align="flex-start">
        <Group gap="sm">
          <Title order={2}>
            Продажа №{sale.number} от {formatDateTime(sale.sold_at)}
          </Title>
          <SaleStatusBadge status={sale.status} />
        </Group>
        <Group gap="sm">
          <Button component={Link} to={`/sales/${sale.id}/print`} variant="default">
            Печать накладной
          </Button>
          {sale.status === 'posted' && (
            <Button color="red" variant="light" onClick={cancelModal.open}>
              Отменить продажу
            </Button>
          )}
        </Group>
      </Group>

      {sale.status === 'cancelled' && (
        <Alert color="red" title="Продажа отменена">
          {sale.cancelled_at && <Text size="sm">Когда: {formatDateTime(sale.cancelled_at)}</Text>}
          {sale.cancelled_by_name && <Text size="sm">Кто: {sale.cancelled_by_name}</Text>}
          {sale.cancel_reason && <Text size="sm">Причина: {sale.cancel_reason}</Text>}
        </Alert>
      )}

      <Stack gap={4}>
        <Text>
          Покупатель:{' '}
          {sale.customer ? (
            <>
              <Anchor component={Link} to={`/customers/${sale.customer.id}`} fw={600}>
                {sale.customer.name}
              </Anchor>
              {sale.customer.phone && `, ${sale.customer.phone}`}
            </>
          ) : (
            '—'
          )}
        </Text>
        {sale.note && <Text style={{ whiteSpace: 'pre-wrap' }}>Заметка: {sale.note}</Text>}
        <Text c="dimmed" size="sm">
          Провёл: {sale.created_by_name}, {formatDateTime(sale.created_at)}
        </Text>
      </Stack>

      <LinesTable lines={sale.lines} />
      <LinesCards lines={sale.lines} />

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="baseline">
          <Text>
            Позиций: {sale.lines.length}, штук:{' '}
            {sale.lines.reduce((sum, line) => sum + line.qty, 0)}
          </Text>
          <Text fz={28} fw={700}>
            ИТОГО: {formatMoney(sale.total)}
          </Text>
        </Group>
      </Paper>

      <CancelDocumentModal
        opened={cancelOpened}
        onClose={cancelModal.close}
        title={`Отменить продажу №${sale.number}?`}
        description="Товары из продажи вернутся на остаток. Сама продажа останется в истории как отменённая."
        confirmLabel="Отменить продажу"
        cancel={cancel}
        successMessage={(saved) => `Продажа №${saved.number} отменена`}
      />
    </Stack>
  )
}

function SaleNotFound() {
  return <NotFoundState title="Продажа не найдена" backTo="/sales" backLabel="К истории продаж" />
}

function SaleLoader({ id }: { id: number }) {
  const sale = useSale(id)

  if (sale.isPending) return <Loader />
  if (sale.isError) {
    if (isApiError(sale.error) && sale.error.status === 404) return <SaleNotFound />
    return <QueryError error={sale.error} onRetry={() => sale.refetch()} />
  }
  return <SaleDetails sale={sale.data} />
}

export function SalePage() {
  const id = parseId(useParams().id)
  if (id === null) return <SaleNotFound />
  return <SaleLoader key={id} id={id} />
}
