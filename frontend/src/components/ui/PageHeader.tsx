import { Group, Stack, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'

import { ReturnLink, type ReturnLinkProps } from './ReturnLink'

export interface PageHeaderProps {
  /** The way back, if the page has one. Never more than one. */
  back?: ReturnLinkProps
  /** The only h1 of the page. */
  title: ReactNode
  /** Next to the title: a badge, for example. */
  titleAside?: ReactNode
  /** Under the title, secondary text. */
  subtitle?: ReactNode
  /** Page actions on the right, buttons of size md. */
  actions?: ReactNode
}

/** Top of every page (design-system.md, «Анатомия страницы»): back link, h1, actions. */
export function PageHeader({ back, title, titleAside, subtitle, actions }: PageHeaderProps) {
  return (
    <Stack gap="md">
      {back && <ReturnLink {...back} />}
      <Group justify="space-between" align="flex-start" gap="md">
        <Stack gap="xs" miw={0} style={{ flex: '1 1 320px' }}>
          <Group gap="sm" align="center">
            <Title order={1} style={{ overflowWrap: 'anywhere' }}>
              {title}
            </Title>
            {titleAside}
          </Group>
          {subtitle && <Text c="dimmed">{subtitle}</Text>}
        </Stack>
        {actions && (
          <Group gap="sm" style={{ flex: '0 1 auto' }}>
            {actions}
          </Group>
        )}
      </Group>
    </Stack>
  )
}
