import { Stack, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'

import { CheckIcon } from '../icons'

export interface DoneScreenProps {
  color: 'green' | 'blue'
  title: string
  /** Summary lines: «Жүкқұжат №12», «Сомасы: 38 400 ₸». */
  lines: ReactNode[]
  /** Buttons, the main one first. */
  children: ReactNode
}

/** A document is saved: a circle with a check, what was saved and what to do next. */
export function DoneScreen({ color, title, lines, children }: DoneScreenProps) {
  return (
    <Stack className="flow-done" align="center" gap="lg">
      <span className="flow-done-circle" data-color={color}>
        <CheckIcon size={48} strokeWidth={2.5} />
      </span>
      <Title order={1}>{title}</Title>
      <Stack gap="xs" align="center">
        {lines.map((line, index) => (
          <Text key={index} fz="lg" lh="lg">
            {line}
          </Text>
        ))}
      </Stack>
      <Stack gap="sm" w="100%" maw={480}>
        {children}
      </Stack>
    </Stack>
  )
}
