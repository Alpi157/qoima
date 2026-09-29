import { Button, Stack, Text } from '@mantine/core'

import { Card } from './ui'

export interface EmptyStateProps {
  text: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ text, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Card>
      <Stack align="center" gap="md">
        <Text c="dimmed" ta="center">
          {text}
        </Text>
        {actionLabel && onAction && <Button onClick={onAction}>{actionLabel}</Button>}
      </Stack>
    </Card>
  )
}
