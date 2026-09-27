import { Badge } from '@mantine/core'

import { saleStatusLabel } from '../../lib/labels'

export function SaleStatusBadge({ status }: { status: string }) {
  return (
    <Badge color={status === 'cancelled' ? 'red' : 'green'} variant="light">
      {saleStatusLabel(status)}
    </Badge>
  )
}
