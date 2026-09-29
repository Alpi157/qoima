import { Card as MantineCard, type CardProps as MantineCardProps, Stack } from '@mantine/core'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { SectionTitle } from './SectionTitle'

export interface CardProps
  extends
    MantineCardProps,
    Omit<ComponentPropsWithoutRef<'div'>, keyof MantineCardProps | 'title'> {
  /** Block title, h3 style (h2 in the document outline: the page has its h1). */
  title?: ReactNode
  children?: ReactNode
}

/** White surface: 1px #D5DCE3 border, radius 12, 24 inside, no shadow (defaults in theme.ts). */
export function Card({ title, children, ...props }: CardProps) {
  return (
    <MantineCard {...props}>
      {title ? (
        <Stack gap="md">
          <SectionTitle>{title}</SectionTitle>
          {children}
        </Stack>
      ) : (
        children
      )}
    </MantineCard>
  )
}
