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
import { unitLabel } from '../../lib/labels'
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
  const { t } = useTranslation()
  return (
    <Table.ScrollContainer minWidth={600} visibleFrom="sm">
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('sales.lines.article')}</Table.Th>
            <Table.Th>{t('sales.lines.name')}</Table.Th>
            <Table.Th ta="right">{t('sales.lines.qty')}</Table.Th>
            <Table.Th ta="right">{t('sales.lines.price')}</Table.Th>
            <Table.Th ta="right">{t('sales.lines.sum')}</Table.Th>
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
                {line.qty} {unitLabel(line.unit)}
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
              {line.qty} {unitLabel(line.unit)} × {formatMoney(line.unit_price)}
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
  const { t } = useTranslation()

  return (
    <Stack>
      <Anchor component={Link} to="/sales" size="sm">
        {t('sales.card.back')}
      </Anchor>

      <Group justify="space-between" align="flex-start">
        <Group gap="sm">
          <Title order={2}>
            {t('sales.card.title', { number: sale.number, date: formatDateTime(sale.sold_at) })}
          </Title>
          <SaleStatusBadge status={sale.status} />
        </Group>
        <Group gap="sm">
          <Button component={Link} to={`/sales/${sale.id}/print`} variant="default">
            {t('sales.card.print')}
          </Button>
          {sale.status === 'posted' && (
            <Button color="red" variant="light" onClick={cancelModal.open}>
              {t('sales.cancel.confirm')}
            </Button>
          )}
        </Group>
      </Group>

      {sale.status === 'cancelled' && (
        <Alert color="red" title={t('sales.card.cancelled')}>
          {sale.cancelled_at && (
            <Text size="sm">
              {t('common.cancelled.when', { date: formatDateTime(sale.cancelled_at) })}
            </Text>
          )}
          {sale.cancelled_by_name && (
            <Text size="sm">{t('common.cancelled.who', { name: sale.cancelled_by_name })}</Text>
          )}
          {sale.cancel_reason && (
            <Text size="sm">{t('common.cancelled.reason', { reason: sale.cancel_reason })}</Text>
          )}
        </Alert>
      )}

      <Stack gap={4}>
        <Text>
          {t('sales.card.customer')}{' '}
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
        {sale.note && (
          <Text style={{ whiteSpace: 'pre-wrap' }}>
            {t('sales.card.note', { note: sale.note })}
          </Text>
        )}
        <Text c="dimmed" size="sm">
          {t('common.postedBy', {
            name: sale.created_by_name,
            date: formatDateTime(sale.created_at),
          })}
        </Text>
      </Stack>

      <LinesTable lines={sale.lines} />
      <LinesCards lines={sale.lines} />

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="baseline">
          <Text>
            {t('sales.list.cardCounts', {
              positions: sale.lines.length,
              pieces: sale.lines.reduce((sum, line) => sum + line.qty, 0),
            })}
          </Text>
          <Text fz={28} fw={700}>
            {t('sales.card.total', { amount: formatMoney(sale.total) })}
          </Text>
        </Group>
      </Paper>

      <CancelDocumentModal
        opened={cancelOpened}
        onClose={cancelModal.close}
        title={t('sales.cancel.title', { number: sale.number })}
        description={t('sales.cancel.description')}
        confirmLabel={t('sales.cancel.confirm')}
        cancel={cancel}
        successMessage={(saved) => t('sales.cancel.done', { number: saved.number })}
      />
    </Stack>
  )
}

function SaleNotFound() {
  const { t } = useTranslation()
  return (
    <NotFoundState title={t('sales.notFound')} backTo="/sales" backLabel={t('sales.backToList')} />
  )
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
