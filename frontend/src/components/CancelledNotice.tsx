import { Alert, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { formatDateTime } from '../lib/dates'

export interface CancelledNoticeProps {
  title: string
  document: {
    cancelled_at?: string | null
    cancelled_by_name?: string | null
    cancel_reason?: string | null
  }
}

/** On a cancelled document's card: when, who and why. */
export function CancelledNotice({ title, document }: CancelledNoticeProps) {
  const { t } = useTranslation()
  return (
    <Alert color="red" title={title}>
      <Stack gap="xs">
        {document.cancelled_at && (
          <Text>{t('common.cancelled.when', { date: formatDateTime(document.cancelled_at) })}</Text>
        )}
        {document.cancelled_by_name && (
          <Text>{t('common.cancelled.who', { name: document.cancelled_by_name })}</Text>
        )}
        {document.cancel_reason && (
          <Text>{t('common.cancelled.reason', { reason: document.cancel_reason })}</Text>
        )}
      </Stack>
    </Alert>
  )
}
