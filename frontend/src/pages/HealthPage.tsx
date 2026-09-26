import { Alert, Container, Loader, Stack, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'

import { fetchHealth } from '../api/health'

export function HealthPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  })

  const isOk = data?.status === 'ok'

  return (
    <Container size="sm" py="xl">
      <Stack>
        <Title order={1}>Autoparts</Title>
        {isLoading && <Loader />}
        {isError && (
          <Alert color="red" title="Ошибка">
            Не удалось получить статус API
          </Alert>
        )}
        {data && (
          <Alert color={isOk ? 'green' : 'red'} title="Статус API">
            API: {isOk ? 'ok' : 'ошибка, база данных недоступна'}
          </Alert>
        )}
      </Stack>
    </Container>
  )
}
