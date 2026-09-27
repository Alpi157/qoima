import { Alert, Button, Center, Loader, Stack } from '@mantine/core'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { isApiError, SERVER_UNAVAILABLE } from '../api/errors'
import { loginPathFor } from '../lib/nextPath'
import { useMe } from './useMe'

export function ProtectedRoute() {
  const location = useLocation()
  const me = useMe()

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
          <Alert color="red" title="Ошибка">
            {isApiError(me.error) ? me.error.detail : SERVER_UNAVAILABLE}
          </Alert>
          <Button onClick={() => me.refetch()} loading={me.isFetching}>
            Повторить
          </Button>
        </Stack>
      </Center>
    )
  }

  return <Outlet />
}
