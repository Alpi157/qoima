import { Button, Paper, Stack, Text } from '@mantine/core'

export interface EmptyStateProps {
  text: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ text, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Paper withBorder p="xl" radius="md">
      <Stack align="center" gap="md">
        <Text c="dimmed" ta="center">
          {text}
        </Text>
        {actionLabel && onAction && <Button onClick={onAction}>{actionLabel}</Button>}
      </Stack>
    </Paper>
  )
}
