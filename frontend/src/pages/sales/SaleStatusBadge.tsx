import { Group } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '../../components/ui'
import { saleStatusLabel } from '../../lib/labels'

export function SaleStatusBadge({
  status,
  debtAtSale = 0,
}: {
  status: string
  debtAtSale?: number
}) {
  // Re-render on a language switch: the label is read outside React.
  const { t } = useTranslation()
  const statusBadge = (
    <StatusBadge tone={status === 'cancelled' ? 'cancelled' : 'posted'}>
      {saleStatusLabel(status)}
    </StatusBadge>
  )
  if (debtAtSale <= 0) return statusBadge
  return (
    <Group gap="xs" wrap="wrap">
      {statusBadge}
      {debtAtSale > 0 && <StatusBadge tone="warning">{t('sell.payment.debt')}</StatusBadge>}
    </Group>
  )
}
