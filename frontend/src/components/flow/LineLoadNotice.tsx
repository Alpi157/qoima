import { Alert, Button, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

import { Card } from '../ui'

export function LineLoadNotice({
  error,
  reload,
  removed,
}: {
  error: boolean
  reload: () => unknown
  removed: string[]
}) {
  const { t } = useTranslation()
  return (
    <>
      {removed.length > 0 && (
        <Alert color="blue" role="status" data-testid="removed-products">
          {t('flow.removed', { articles: removed.join(t('common.listSeparator')) })}
        </Alert>
      )}
      {error && (
        <Alert color="blue" role="status" data-testid="line-load-error">
          <Stack gap="md">
            <Text>{t('flow.noConnection')}</Text>
            <Button
              variant="default"
              onClick={() => {
                void reload()
              }}
              style={{ alignSelf: 'flex-start' }}
            >
              {t('common.retry')}
            </Button>
          </Stack>
        </Alert>
      )}
    </>
  )
}

export function UnloadedLine({
  article,
  name,
  children,
}: {
  article?: string
  name?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Card data-testid="flow-line">
      <Stack gap="xs">
        <Text fw={600}>{article ?? t('common.notFoundShort')}</Text>
        {name && <Text c="dimmed">{name}</Text>}
        {children}
        <Text c="dimmed">{t('flow.blocked.loading')}</Text>
      </Stack>
    </Card>
  )
}
