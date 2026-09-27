import { Alert, Button, Stack } from '@mantine/core'

import { isApiError, SERVER_UNAVAILABLE } from '../api/errors'

export interface QueryErrorProps {
  error: unknown
  onRetry: () => void
}

/** A list or card failed to load: the message and a retry button. */
export function QueryError({ error, onRetry }: QueryErrorProps) {
  return (
    <Stack align="flex-start">
      <Alert color="red" title="Ошибка">
        {isApiError(error) ? error.detail : SERVER_UNAVAILABLE}
      </Alert>
      <Button variant="default" onClick={onRetry}>
        Повторить
      </Button>
    </Stack>
  )
}
