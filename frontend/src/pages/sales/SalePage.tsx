import { Anchor, Button, Group, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { isApiError } from '../../api/errors'
import { CancelDocumentModal } from '../../components/CancelDocumentModal'
import { CancelledNotice } from '../../components/CancelledNotice'
import { NotFoundState } from '../../components/NotFoundState'
import { PaymentMethodText } from '../../components/PaymentMethodChoice'
import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import {
  Card,
  DataTable,
  type DataTableColumn,
  PageContainer,
  PageHeader,
  Stat,
  SectionTitle,
} from '../../components/ui'
import { formatDateTime } from '../../lib/dates'
import { unitLabel } from '../../lib/labels'
import { formatAmount, formatMoney } from '../../lib/money'
import { parseId } from '../../lib/routeParams'
import { type Sale, useCancelSale, useSale } from './api'
import { SaleStatusBadge } from './SaleStatusBadge'
import { PaymentStatusBadge } from './PaymentStatusBadge'
import { ReturnStatusBadge } from '../returns/ReturnStatusBadge'

type SaleLineOut = Sale['lines'][number]

function ProductLink({ line }: { line: SaleLineOut }) {
  return (
    <Anchor component={Link} to={`/products/${line.product_id}`} fw={600}>
      {line.article}
    </Anchor>
  )
}

function LineCard({ line }: { line: SaleLineOut }) {
  const { t } = useTranslation()
  return (
    <Stack gap="xs">
      <ProductLink line={line} />
      <Text>{line.name}</Text>
      {line.returned_qty > 0 && (
        <Text size="sm">
          {t('sales.lines.returned')}: {line.returned_qty}
        </Text>
      )}
      <Group justify="space-between">
        <Text size="sm">
          {line.qty} {unitLabel(line.unit)} × {formatMoney(line.unit_price)}
        </Text>
        <Text fw={600}>{formatMoney(line.line_total)}</Text>
      </Group>
    </Stack>
  )
}

function LinesTable({ lines }: { lines: SaleLineOut[] }) {
  const { t } = useTranslation()
  const columns: DataTableColumn<SaleLineOut>[] = [
    {
      key: 'article',
      header: t('sales.lines.article'),
      nowrap: true,
      cell: (line) => <ProductLink line={line} />,
    },
    { key: 'name', header: t('sales.lines.name'), cell: (line) => line.name },
    {
      key: 'qty',
      header: t('sales.lines.qty'),
      numeric: true,
      cell: (line) => `${line.qty} ${unitLabel(line.unit)}`,
    },
    {
      key: 'returned',
      header: t('sales.lines.returned'),
      numeric: true,
      cell: (line) => line.returned_qty || '',
    },
    {
      key: 'price',
      header: t('sales.lines.price'),
      numeric: true,
      cell: (line) => formatMoney(line.unit_price),
    },
    {
      key: 'sum',
      header: t('sales.lines.sum'),
      numeric: true,
      cell: (line) => formatMoney(line.line_total),
    },
  ]
  return (
    <DataTable
      rows={lines}
      rowKey={(line) => line.id}
      columns={columns}
      mobileCard={(line) => <LineCard line={line} />}
    />
  )
}

function SaleDetails({ sale }: { sale: Sale }) {
  const [cancelOpened, cancelModal] = useDisclosure()
  const cancel = useCancelSale(sale.id)
  const { t } = useTranslation()
  const hasReturns = sale.returns.some((document) => document.status === 'posted')
  const canReturn =
    sale.status === 'posted' && sale.lines.some((line) => line.returned_qty < line.qty)

  return (
    <PageContainer>
      <PageHeader
        back={{ to: '/sales', label: t('sales.card.back') }}
        title={t('sales.card.title', { number: sale.number, date: formatDateTime(sale.sold_at) })}
        titleAside={<SaleStatusBadge status={sale.status} />}
        subtitle={t('common.postedBy', {
          name: sale.created_by_name,
          date: formatDateTime(sale.created_at),
        })}
        actions={
          <>
            <Button component={Link} to={`/sales/${sale.id}/print`}>
              {t('sales.card.print')}
            </Button>
            {canReturn && (
              <Button component={Link} variant="default" to={`/sales/${sale.id}/return`}>
                {t('returns.action')}
              </Button>
            )}
            {sale.status === 'posted' && !hasReturns && (
              <Button variant="default" c="red" onClick={cancelModal.open}>
                {t('sales.cancel.confirm')}
              </Button>
            )}
          </>
        }
      />

      {sale.status === 'cancelled' && (
        <CancelledNotice title={t('sales.card.cancelled')} document={sale} />
      )}

      <Card>
        <Stack gap="xs">
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
        </Stack>
      </Card>

      <Stack gap="md">
        <LinesTable lines={sale.lines} />
        <Card>
          <Group justify="space-between" align="flex-end" gap="md">
            <Text c="dimmed">
              {t('sales.list.cardCounts', {
                positions: sale.lines.length,
                pieces: sale.lines.reduce((sum, line) => sum + line.qty, 0),
              })}
            </Text>
            <Stack gap="xs">
              <Stat
                size="display"
                label={t('sales.card.total')}
                value={formatAmount(sale.total)}
                unit="₸"
              />
              {sale.discount_total !== null && sale.discount_total > 0 && (
                <Text size="sm" c="dimmed">
                  {t('sell.discountTotal', { amount: formatMoney(sale.discount_total) })}
                </Text>
              )}
            </Stack>
          </Group>
          <Stack gap="xs" mt="md">
            <Group>
              <PaymentStatusBadge
                status={sale.payment_status}
                outstanding={sale.outstanding}
                detail
              />
            </Group>
            <Group gap="xs">
              <Text>{t('sales.card.paid', { amount: formatMoney(sale.paid_at_sale) })}</Text>
              <PaymentMethodText method={sale.payment_method} />
            </Group>
            {(sale.outstanding ?? 0) > 0 && (
              <Text>{t('sales.card.outstanding', { amount: formatMoney(sale.outstanding!) })}</Text>
            )}
          </Stack>
        </Card>
      </Stack>

      {sale.returns.length > 0 && (
        <Stack gap="md">
          <SectionTitle>{t('returns.history')}</SectionTitle>
          <DataTable
            rows={sale.returns}
            rowKey={(document) => document.id}
            columns={[
              {
                key: 'number',
                header: t('sales.list.number'),
                cell: (document) => (
                  <Anchor component={Link} to={`/returns/${document.id}`}>
                    {document.number}
                  </Anchor>
                ),
              },
              {
                key: 'date',
                header: t('sales.list.date'),
                cell: (document) => formatDateTime(document.returned_at),
              },
              {
                key: 'total',
                header: t('sales.list.total'),
                numeric: true,
                cell: (document) => formatMoney(document.total),
              },
              {
                key: 'status',
                header: t('sales.list.status'),
                cell: (document) => <ReturnStatusBadge status={document.status} />,
              },
            ]}
            mobileCard={(document) => (
              <Stack gap="xs">
                <Anchor component={Link} to={`/returns/${document.id}`} fw={600}>
                  {t('returns.title', { number: document.number })}
                </Anchor>
                <Text size="sm">{formatDateTime(document.returned_at)}</Text>
                <Group justify="space-between">
                  <Text>{formatMoney(document.total)}</Text>
                  <ReturnStatusBadge status={document.status} />
                </Group>
              </Stack>
            )}
          />
          {sale.status === 'posted' && hasReturns && (
            <Text size="sm" c="dimmed">
              {t('errors.sale_has_returns')}
            </Text>
          )}
        </Stack>
      )}

      <CancelDocumentModal
        opened={cancelOpened}
        onClose={cancelModal.close}
        title={t('sales.cancel.title', { number: sale.number })}
        description={t('sales.cancel.description')}
        confirmLabel={t('sales.cancel.confirm')}
        cancel={cancel}
        successMessage={(saved) => t('sales.cancel.done', { number: saved.number })}
      />
    </PageContainer>
  )
}

function SaleNotFound() {
  const { t } = useTranslation()
  return (
    <NotFoundState
      title={t('sales.notFound')}
      back={{ to: '/sales', label: t('sales.card.back') }}
    />
  )
}

function SaleLoader({ id }: { id: number }) {
  const sale = useSale(id)

  if (sale.isPending) return <PageLoader />
  if (sale.isError) {
    if (isApiError(sale.error) && sale.error.status === 404) return <SaleNotFound />
    return (
      <PageContainer>
        <QueryError error={sale.error} onRetry={() => sale.refetch()} />
      </PageContainer>
    )
  }
  return <SaleDetails sale={sale.data} />
}

export function SalePage() {
  const id = parseId(useParams().id)
  if (id === null) return <SaleNotFound />
  return <SaleLoader key={id} id={id} />
}
