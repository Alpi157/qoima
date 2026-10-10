import { useTranslation } from 'react-i18next'
import { StatusBadge } from '../../components/ui'
import type { ReturnDocument } from './api'

export function ReturnStatusBadge({ status }: { status: ReturnDocument['status'] }) {
  const { t } = useTranslation()
  return (
    <StatusBadge tone={status}>
      {t(status === 'posted' ? 'returns.status.posted' : 'returns.status.cancelled')}
    </StatusBadge>
  )
}
