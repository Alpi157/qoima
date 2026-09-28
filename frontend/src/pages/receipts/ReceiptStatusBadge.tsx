import { Badge } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { receiptStatusLabel } from '../../lib/labels'

export function ReceiptStatusBadge({ status }: { status: string }) {
  // Re-render on a language switch: the label is read outside React.
  useTranslation()
  return (
    <Badge color={status === 'cancelled' ? 'red' : 'green'} variant="light">
      {receiptStatusLabel(status)}
    </Badge>
  )
}
