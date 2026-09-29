import { Title } from '@mantine/core'
import type { ReactNode } from 'react'

/** Title of a block inside a page: h3 of the font scale, h2 in the outline under the page's h1. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Title order={2} fz="xl" lh="xl" fw={600}>
      {children}
    </Title>
  )
}
