import { Stack, Text, Title } from '@mantine/core'

/** Stub for a section that is built in a later step. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <Stack>
      <Title order={2}>{title}</Title>
      <Text c="dimmed">Раздел в разработке</Text>
    </Stack>
  )
}
