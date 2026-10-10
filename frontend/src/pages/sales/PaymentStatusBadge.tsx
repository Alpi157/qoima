import { Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { StatusBadge } from '../../components/ui'
import { formatMoney } from '../../lib/money'
import type { Sale } from './api'

export function PaymentStatusBadge({
  status,
  outstanding,
  detail = false,
}: {
  status: Sale['payment_status']
  outstanding: Sale['outstanding']
  detail?: boolean
}) {
  const { t } = useTranslation()
  if (status === null || (status === 'paid' && !detail)) return null
  if (status === 'paid') return <Text fw={600}>{t('sales.paymentStatus.paid')}</Text>
  if (status === 'returned')
    return <StatusBadge tone="neutral">{t('sales.paymentStatus.returned')}</StatusBadge>
  return (
    <StatusBadge tone="warning">
      {t(status === 'unpaid' ? 'sales.paymentStatus.unpaid' : 'sales.paymentStatus.partial', {
        amount: formatMoney(outstanding ?? 0),
      })}
    </StatusBadge>
  )
}
