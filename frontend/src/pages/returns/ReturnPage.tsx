import { Anchor, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { isApiError } from '../../api/errors'
import { CancelDocumentModal } from '../../components/CancelDocumentModal'
import { CancelledNotice } from '../../components/CancelledNotice'
import { NotFoundState } from '../../components/NotFoundState'
import { PageLoader } from '../../components/PageLoader'
import { PaymentMethodText } from '../../components/PaymentMethodChoice'
import { QueryError } from '../../components/QueryError'
import { Card, DataTable, PageContainer, PageHeader, Stat, StatusBadge } from '../../components/ui'
import { formatDateTime } from '../../lib/dates'
import { unitLabel } from '../../lib/labels'
import { formatAmount, formatMoney } from '../../lib/money'
import { parseId } from '../../lib/routeParams'
import { type ReturnDocument, useCancelReturn, useReturn } from './api'
import { ReturnStatusBadge } from './ReturnStatusBadge'

type ReturnLine = ReturnDocument['lines'][number]

function ReturnDetails({ document }: { document: ReturnDocument }) {
  const { t } = useTranslation()
  const [opened, modal] = useDisclosure()
  const cancel = useCancelReturn(document.id)
  const product = (line: ReturnLine) => (
    <Anchor component={Link} to={`/products/${line.product_id}`} fw={600}>
      {line.article}
    </Anchor>
  )
  const condition = (line: ReturnLine) => (
    <StatusBadge tone={line.condition === 'defective' ? 'warning' : 'neutral'}>
      {t(line.condition === 'defective' ? 'returns.defective' : 'returns.good')}
    </StatusBadge>
  )
  return (
    <PageContainer>
      <PageHeader
        back={{ to: '/returns', label: t('returns.back') }}
        title={t('returns.title', { number: document.number })}
        titleAside={<ReturnStatusBadge status={document.status} />}
        subtitle={t('common.postedBy', {
          name: document.created_by_name,
          date: formatDateTime(document.created_at),
        })}
        actions={
          document.status === 'posted' && (
            <Button variant="default" c="red" onClick={modal.open}>
              {t('returns.cancel.confirm')}
            </Button>
          )
        }
      />
      {document.status === 'cancelled' && (
        <CancelledNotice title={t('returns.cancel.cancelled')} document={document} />
      )}
      <Card>
        <Stack gap="xs">
          <Anchor component={Link} to={`/sales/${document.sale.id}`} fw={600}>
            {t('returns.sale', { number: document.sale.number })}
          </Anchor>
          <Text>
            {t('returns.date')}: {formatDateTime(document.returned_at)}
          </Text>
          <Text>
            {t('sales.card.customer')}{' '}
            {document.customer ? (
              <Anchor component={Link} to={`/customers/${document.customer.id}`} fw={600}>
                {document.customer.name}
              </Anchor>
            ) : (
              t('sell.review.retail')
            )}
          </Text>
          {document.note && (
            <Text style={{ whiteSpace: 'pre-wrap' }}>
              {t('sales.card.note', { note: document.note })}
            </Text>
          )}
        </Stack>
      </Card>
      <DataTable
        rows={document.lines}
        rowKey={(line) => line.id}
        columns={[
          { key: 'article', header: t('sales.lines.article'), cell: product },
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
            key: 'total',
            header: t('sales.lines.sum'),
            numeric: true,
            cell: (line) => formatMoney(line.line_total),
          },
          { key: 'condition', header: t('returns.condition'), cell: condition },
        ]}
        mobileCard={(line) => (
          <Stack gap="xs">
            {product(line)}
            <Text>{line.name}</Text>
            <Group justify="space-between">
              <Text>
                {line.qty} {unitLabel(line.unit)} × {formatMoney(line.unit_price)}
              </Text>
              <Text fw={600}>{formatMoney(line.line_total)}</Text>
            </Group>
            {condition(line)}
          </Stack>
        )}
      />
      <Card>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
          <Stat
            size="display"
            label={t('returns.total')}
            value={formatAmount(document.total)}
            unit="₸"
          />
          <Stat label={t('returns.credit')} value={formatAmount(document.debt_credit)} unit="₸" />
          <Stack gap="xs">
            <Stat
              label={t('returns.refund')}
              value={formatAmount(document.refund_amount)}
              unit="₸"
            />
            {document.refund_amount > 0 && <PaymentMethodText method={document.refund_method} />}
          </Stack>
        </SimpleGrid>
      </Card>
      <CancelDocumentModal
        opened={opened}
        onClose={modal.close}
        title={t('returns.cancel.title', { number: document.number })}
        description={t('returns.cancel.description')}
        confirmLabel={t('returns.cancel.confirm')}
        cancel={cancel}
        successMessage={(saved) => t('returns.cancel.done', { number: saved.number })}
        quickReasons={['common.cancelDocument.quick.mistake', 'payments.cancel.wrongAmount']}
      />
    </PageContainer>
  )
}

function ReturnNotFound() {
  const { t } = useTranslation()
  return (
    <NotFoundState
      title={t('returns.notFound')}
      back={{ to: '/returns', label: t('returns.back') }}
    />
  )
}

function ReturnLoader({ id }: { id: number }) {
  const query = useReturn(id)
  if (query.isPending) return <PageLoader />
  if (query.isError)
    return isApiError(query.error) && query.error.status === 404 ? (
      <ReturnNotFound />
    ) : (
      <PageContainer>
        <QueryError error={query.error} onRetry={() => query.refetch()} />
      </PageContainer>
    )
  return <ReturnDetails document={query.data} />
}

export function ReturnPage() {
  const id = parseId(useParams().id)
  return id === null ? <ReturnNotFound /> : <ReturnLoader key={id} id={id} />
}
