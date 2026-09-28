import { Alert, Button, Center, Loader, Stack } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { isApiError } from '../api/errors'
import { apiErrorText } from '../i18n/errorText'
import { loginPathFor } from '../lib/nextPath'
import { useMe, useUserLanguage } from './useMe'

export function ProtectedRoute() {
  const location = useLocation()
  const me = useMe()
  const { t } = useTranslation()
  useUserLanguage(me.data)

  if (me.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    )
  }

  if (me.isError) {
    if (isApiError(me.error) && me.error.status === 401) {
      return <Navigate to={loginPathFor(location.pathname, location.search)} replace />
    }
    return (
      <Center h="100vh" p="md">
        <Stack align="center">
          <Alert color="red" title={t('common.error')}>
            {apiErrorText(me.error, t)}
          </Alert>
          <Button onClick={() => me.refetch()} loading={me.isFetching}>
            {t('common.retry')}
          </Button>
        </Stack>
      </Center>
    )
  }

  return <Outlet />
}
