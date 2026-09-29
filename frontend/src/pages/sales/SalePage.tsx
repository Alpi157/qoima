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
  Stat,
} from '../../components/ui'
import { formatDateTime } from '../../lib/dates'
import { unitLabel } from '../../lib/labels'
import { formatAmount, formatMoney } from '../../lib/money'
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

function LineCard({ line }: { line: SaleLineOut }) {
  return (
    <Stack gap="xs">
      <ProductLink line={line} />
      <Text>{line.name}</Text>
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
      rowKey={(line) => line.product_id}
      columns={columns}
      mobileCard={(line) => <LineCard line={line} />}
    />
  )
}

function SaleDetails({ sale }: { sale: Sale }) {
  const [cancelOpened, cancelModal] = useDisclosure()
  const cancel = useCancelSale(sale.id)
  const { t } = useTranslation()

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
            {sale.status === 'posted' && (
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
            <Stat
              size="display"
              label={t('sales.card.total')}
              value={formatAmount(sale.total)}
              unit="₸"
            />
          </Group>
        </Card>
      </Stack>

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
