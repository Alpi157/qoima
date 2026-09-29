import { Button } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { HomeIcon } from '../components/icons'
import { PageContainer, PageHeader } from '../components/ui'
import { HOME_PATH } from '../lib/nextPath'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <PageContainer>
      <PageHeader title={t('common.notFound.title')} />
      <div>
        <Button component={Link} to={HOME_PATH} size="lg" leftSection={<HomeIcon size={24} />}>
          {t('common.notFound.toHome')}
        </Button>
      </div>
    </PageContainer>
  )
}
