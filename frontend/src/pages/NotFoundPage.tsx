import { Button, Stack, Title } from '@mantine/core'
import { Link } from 'react-router-dom'

import { DEFAULT_PATH } from '../lib/nextPath'

export function NotFoundPage() {
  return (
    <Stack align="flex-start">
      <Title order={2}>Страница не найдена</Title>
      <Button component={Link} to={DEFAULT_PATH}>
        Перейти к продаже
      </Button>
    </Stack>
  )
}
