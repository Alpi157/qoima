import {
  Alert,
  Button,
  Center,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { api, unwrap } from '../api/client'
import { isApiError, SERVER_UNAVAILABLE } from '../api/errors'
import { ME_QUERY_KEY, useMe } from '../auth/useMe'
import { safeNext } from '../lib/nextPath'

interface LoginValues {
  username: string
  password: string
}

export function LoginPage() {
  const me = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const form = useForm<LoginValues>({
    mode: 'uncontrolled',
    initialValues: { username: '', password: '' },
    validate: {
      username: (value) => (value.trim() ? null : 'Введите логин'),
      password: (value) => (value ? null : 'Введите пароль'),
    },
  })

  const login = useMutation({
    mutationFn: (values: LoginValues) =>
      unwrap(
        api.POST('/api/auth/login', { body: { ...values, username: values.username.trim() } }),
      ),
    onSuccess: (user) => {
      queryClient.setQueryData(ME_QUERY_KEY, user)
      navigate(safeNext(searchParams.get('next')), { replace: true })
    },
    onError: (error) => {
      if (isApiError(error)) form.setErrors(error.fieldErrors)
    },
  })

  if (me.isSuccess) return <Navigate to={safeNext(searchParams.get('next'))} replace />

  if (me.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    )
  }

  const errorText = login.isError
    ? isApiError(login.error)
      ? login.error.detail
      : SERVER_UNAVAILABLE
    : null

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" radius="md" w="100%" maw={400}>
        <form onSubmit={form.onSubmit((values) => login.mutate(values))} noValidate>
          <Stack>
            <Title order={2} ta="center">
              Qoima
            </Title>
            <TextInput
              label="Логин"
              autoComplete="username"
              autoFocus
              key={form.key('username')}
              {...form.getInputProps('username')}
            />
            <PasswordInput
              label="Пароль"
              autoComplete="current-password"
              key={form.key('password')}
              {...form.getInputProps('password')}
            />
            {errorText && (
              <Alert color="red" role="alert">
                {errorText}
              </Alert>
            )}
            <Button type="submit" loading={login.isPending} fullWidth>
              Войти
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}
