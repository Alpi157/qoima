import { Button, Stack, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { DEFAULT_PATH } from '../lib/nextPath'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <Stack align="flex-start">
      <Title order={2}>{t('common.notFound.title')}</Title>
      <Button component={Link} to={DEFAULT_PATH}>
        {t('common.notFound.toSale')}
      </Button>
    </Stack>
  )
}
