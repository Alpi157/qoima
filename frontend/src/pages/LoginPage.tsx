import {
  Alert,
  Button,
  Center,
  Loader,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { api, unwrap } from '../api/client'
import { isApiError } from '../api/errors'
import { ME_QUERY_KEY, useMe } from '../auth/useMe'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Card } from '../components/ui'
import { apiErrorText, fieldErrorText } from '../i18n/errorText'
import { applyLanguage } from '../i18n/language'
import { safeNext } from '../lib/nextPath'

// Large fields for the login form: 60px high, 22px text.
interface LoginValues {
  username: string
  password: string
}

export function LoginPage() {
  const me = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { t } = useTranslation()

  const form = useForm<LoginValues>({
    mode: 'uncontrolled',
    initialValues: { username: '', password: '' },
    validate: {
      username: (value) => (value.trim() ? null : t('auth.login.usernameRequired')),
      password: (value) => (value ? null : t('auth.login.passwordRequired')),
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
      if (!isApiError(error)) return
      form.setErrors(
        Object.fromEntries(
          Object.entries(error.fieldErrors).map(([field, fieldError]) => [
            field,
            fieldErrorText(fieldError, field),
          ]),
        ),
      )
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

  const errorText = login.isError ? apiErrorText(login.error, t) : null

  return (
    <Stack mih="100vh" px="var(--q-gutter)" py="xl" gap="lg" align="center" justify="center">
      <LanguageSwitcher onChange={(language) => void applyLanguage(language)} />
      <Card w="100%" maw={480}>
        <form onSubmit={form.onSubmit((values) => login.mutate(values))} noValidate>
          <Stack gap="lg">
            <Title order={1} ta="center">
              Qoima
            </Title>
            <TextInput
              label={t('auth.login.username')}
              autoComplete="username"
              autoFocus
              key={form.key('username')}
              {...form.getInputProps('username')}
            />
            <PasswordInput
              label={t('auth.login.password')}
              autoComplete="current-password"
              key={form.key('password')}
              {...form.getInputProps('password')}
            />
            {errorText && (
              <Alert color="red" role="alert">
                {errorText}
              </Alert>
            )}
            <Button type="submit" loading={login.isPending} fullWidth size="lg">
              {t('auth.login.submit')}
            </Button>
          </Stack>
        </form>
      </Card>
    </Stack>
  )
}
