import { Anchor, Stack, Title } from '@mantine/core'
import { Link } from 'react-router-dom'

export interface NotFoundStateProps {
  title: string
  backTo: string
  backLabel: string
}

/** Shown by a detail page when the server answers 404. */
export function NotFoundState({ title, backTo, backLabel }: NotFoundStateProps) {
  return (
    <Stack align="flex-start">
      <Title order={2}>{title}</Title>
      <Anchor component={Link} to={backTo}>
        {backLabel}
      </Anchor>
    </Stack>
  )
}
