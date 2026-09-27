import { Badge } from '@mantine/core'

import { receiptStatusLabel } from '../../lib/labels'

export function ReceiptStatusBadge({ status }: { status: string }) {
  return (
    <Badge color={status === 'cancelled' ? 'red' : 'green'} variant="light">
      {receiptStatusLabel(status)}
    </Badge>
  )
}
