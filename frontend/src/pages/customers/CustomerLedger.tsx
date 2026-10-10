import { Button, Group, Stack, Text, VisuallyHidden } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CancelDocumentModal } from '../../components/CancelDocumentModal'
import { ListPagination } from '../../components/ListPagination'
import { PaymentMethodText } from '../../components/PaymentMethodChoice'
import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import { DataTable, RowLink } from '../../components/ui'
import { formatDateTime } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { PAGE_SIZE } from '../../lib/pagination'
import { useListParams } from '../../lib/useListParams'
import { useCancelPayment } from '../payments/api'
import { useCancelDebtAdjustment } from '../debtAdjustments/api'
import { type LedgerItem, useCustomerLedger } from './api'

function formatDebtChange(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '\u2212' : ''}${formatMoney(Math.abs(value))}`
}

function PaymentCancellation({ item, onClose }: { item: LedgerItem; onClose: () => void }) {
  const { t } = useTranslation()
  const cancel = useCancelPayment(item.id)
  return (
    <CancelDocumentModal
      opened
      onClose={onClose}
      title={t('payments.cancel.title', { number: item.number })}
      description={t('payments.cancel.description')}
      confirmLabel={t('payments.cancel.confirm')}
      cancel={cancel}
      successMessage={(saved) => t('payments.cancel.done', { number: saved.number })}
      quickReasons={['common.cancelDocument.quick.mistake', 'payments.cancel.wrongAmount']}
    />
  )
}

function AdjustmentCancellation({ item, onClose }: { item: LedgerItem; onClose: () => void }) {
  const { t } = useTranslation()
  const cancel = useCancelDebtAdjustment(item.id)
  return (
    <CancelDocumentModal
      opened
      onClose={onClose}
      title={t('debtAdjustments.cancel.title', { number: item.number })}
      description={t('debtAdjustments.cancel.description')}
      confirmLabel={t('debtAdjustments.cancel.confirm')}
      cancel={cancel}
      successMessage={(saved) => t('debtAdjustments.cancel.done', { number: saved.number })}
      quickReasons={['common.cancelDocument.quick.mistake']}
    />
  )
}

export function CustomerLedger({ customerId }: { customerId: number }) {
  const { t } = useTranslation()
  const { page, setPage } = useListParams('ledgerPage')
  const query = useCustomerLedger(customerId, page)
  const [cancelling, setCancelling] = useState<LedgerItem | null>(null)
  useEffect(() => {
    if (query.data && !query.isPlaceholderData && page > 1 && query.data.items.length === 0)
      setPage(Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)))
  }, [query.data, query.isPlaceholderData, page, setPage])
  const document = (item: LedgerItem) =>
    item.kind === 'sale' ? (
      <RowLink to={`/sales/${item.id}`}>
        {t('customers.ledger.sale', { number: item.number })}
      </RowLink>
    ) : item.kind === 'return' ? (
      <RowLink to={`/returns/${item.id}`}>{t('returns.title', { number: item.number })}</RowLink>
    ) : item.kind === 'adjustment' ? (
      <Stack gap={0}>
        <Text>{t('debtAdjustments.document', { number: item.number })}</Text>
        <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {item.reason}
        </Text>
      </Stack>
    ) : (
      <Text>{t('customers.ledger.payment', { number: item.number })}</Text>
    )
  const amount = (item: LedgerItem) => (
    <Stack gap={0}>
      <Text>{formatMoney(item.amount)}</Text>
      {item.kind === 'sale' && (item.paid_at_sale ?? 0) > 0 && (
        <Text size="sm" c="dimmed">
          {t('sales.card.paid', { amount: formatMoney(item.paid_at_sale!) })}
        </Text>
      )}
      <PaymentMethodText method={item.payment_method} />
      {item.kind === 'return' && (item.refund_amount ?? 0) > 0 && (
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            {t('returns.refundAmount', { amount: formatMoney(item.refund_amount!) })}
          </Text>
          <PaymentMethodText method={item.refund_method} />
        </Group>
      )}
    </Stack>
  )
  const action = (item: LedgerItem) =>
    (item.kind === 'payment' || item.kind === 'adjustment') && (
      <Button size="sm" variant="default" onClick={() => setCancelling(item)}>
        {t('customers.ledger.cancel')}
      </Button>
    )

  if (query.isPending) return <PageLoader />
  if (query.isError) return <QueryError error={query.error} onRetry={() => query.refetch()} />
  return (
    <Stack gap="md">
      {query.data.total === 0 ? (
        <Text c="dimmed">{t('customers.ledger.empty')}</Text>
      ) : (
        <>
          <DataTable
            rows={query.data.items}
            rowKey={(row) => `${row.kind}-${row.id}`}
            columns={[
              {
                key: 'date',
                header: t('customers.ledger.date'),
                cell: (row) => formatDateTime(row.occurred_at),
                nowrap: true,
              },
              { key: 'document', header: t('customers.ledger.document'), cell: document },
              {
                key: 'amount',
                header: t('customers.ledger.amount'),
                cell: amount,
                numeric: true,
              },
              {
                key: 'change',
                header: t('customers.ledger.change'),
                cell: (row) => formatDebtChange(row.debt_change),
                numeric: true,
              },
              {
                key: 'after',
                header: t('customers.ledger.after'),
                cell: (row) => formatMoney(row.debt_after),
                numeric: true,
              },
              {
                key: 'action',
                header: <VisuallyHidden>{t('customers.ledger.cancel')}</VisuallyHidden>,
                cell: action,
              },
            ]}
            mobileCard={(row) => (
              <Stack gap="xs">
                {document(row)}
                <Text size="sm" c="dimmed">
                  {formatDateTime(row.occurred_at)}
                </Text>
                <Group justify="space-between">
                  <Text>{t('customers.ledger.amount')}</Text>
                  {amount(row)}
                </Group>
                <Group justify="space-between">
                  <Text>{t('customers.ledger.change')}</Text>
                  <Text>{formatDebtChange(row.debt_change)}</Text>
                </Group>
                <Group justify="space-between">
                  <Text>{t('customers.ledger.after')}</Text>
                  <Text fw={600}>{formatMoney(row.debt_after)}</Text>
                </Group>
                {(row.kind === 'payment' || row.kind === 'adjustment') && (
                  <Group>{action(row)}</Group>
                )}
              </Stack>
            )}
          />
          <ListPagination total={query.data.total} page={page} onChange={setPage} />
        </>
      )}
      {cancelling &&
        (cancelling.kind === 'adjustment' ? (
          <AdjustmentCancellation item={cancelling} onClose={() => setCancelling(null)} />
        ) : (
          <PaymentCancellation item={cancelling} onClose={() => setCancelling(null)} />
        ))}
    </Stack>
  )
}
