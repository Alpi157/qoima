import { Alert, Button, Stack } from '@mantine/core'

import { useTranslation } from 'react-i18next'

import { apiErrorText } from '../i18n/errorText'

export interface QueryErrorProps {
  error: unknown
  onRetry: () => void
}

/** A list or card failed to load: the message and a retry button. */
export function QueryError({ error, onRetry }: QueryErrorProps) {
  const { t } = useTranslation()
  return (
    <Stack align="flex-start">
      <Alert color="red" title={t('common.error')}>
        {apiErrorText(error, t)}
      </Alert>
      <Button variant="default" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </Stack>
  )
}
