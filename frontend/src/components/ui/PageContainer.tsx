import { Box, Stack } from '@mantine/core'
import type { ReactNode } from 'react'

/**
 * The page grid: max width 1200 in the middle, 32 at the sides (16 up to 768 wide), 32 on top.
 * Parts of the page (header, cards, tables) stand 32 apart.
 */
export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <Box
      maw="var(--q-container)"
      mx="auto"
      px="var(--q-gutter)"
      pt="var(--q-space-32)"
      pb="var(--q-space-48)"
    >
      <Stack gap="xl">{children}</Stack>
    </Box>
  )
}
