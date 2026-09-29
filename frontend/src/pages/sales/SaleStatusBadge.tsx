import { useTranslation } from 'react-i18next'

import { StatusBadge } from '../../components/ui'
import { saleStatusLabel } from '../../lib/labels'

export function SaleStatusBadge({ status }: { status: string }) {
  // Re-render on a language switch: the label is read outside React.
  useTranslation()
  return (
    <StatusBadge tone={status === 'cancelled' ? 'cancelled' : 'posted'}>
      {saleStatusLabel(status)}
    </StatusBadge>
  )
}
