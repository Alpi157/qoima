import { Anchor, Button, Group } from '@mantine/core'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useRouteError } from 'react-router-dom'

import { HOME_PATH } from '../lib/nextPath'
import { reloadPage } from '../lib/browserReload'
import { PageModuleError } from '../lib/pageReload'
import { PageContainer, PageHeader } from './ui'

export function RouteErrorPage() {
  const error = useRouteError()
  const { t } = useTranslation()
  const moduleError = error instanceof PageModuleError
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <PageContainer>
      <PageHeader
        title={t(moduleError ? 'common.routeError.moduleTitle' : 'common.routeError.title')}
        subtitle={t(
          moduleError ? 'common.routeError.moduleDescription' : 'common.routeError.description',
        )}
      />
      <Group gap="lg">
        <Button size="lg" onClick={reloadPage}>
          {t('common.routeError.reload')}
        </Button>
        <Anchor component={Link} to={HOME_PATH} fw={600}>
          {t('common.notFound.toHome')}
        </Anchor>
      </Group>
    </PageContainer>
  )
}
