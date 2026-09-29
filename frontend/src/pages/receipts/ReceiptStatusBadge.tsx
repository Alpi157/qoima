import { useTranslation } from 'react-i18next'

import { StatusBadge } from '../../components/ui'
import { receiptStatusLabel } from '../../lib/labels'

export function ReceiptStatusBadge({ status }: { status: string }) {
  // Re-render on a language switch: the label is read outside React.
  useTranslation()
  return (
    <StatusBadge tone={status === 'cancelled' ? 'cancelled' : 'posted'}>
      {receiptStatusLabel(status)}
    </StatusBadge>
  )
}
