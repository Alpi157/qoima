import { Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'

export interface StatProps {
  label: ReactNode
  value: ReactNode
  /** «дана», «₸»: the same size as the number, weight 500. */
  unit?: ReactNode
  /** display: the main number of the screen; h2: the others. */
  size?: 'display' | 'h2'
  color?: string
  /** data-testid of the value, for tests that read the number. */
  testId?: string
}

/** A number with a caption above it: «Қалдық 10 дана», «Бағасы 1 500 ₸». */
export function Stat({ label, value, unit, size = 'h2', color, testId }: StatProps) {
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text
        className={size === 'display' ? 'q-display' : undefined}
        fz={size === 'h2' ? 'var(--q-fz-h2)' : undefined}
        lh={size === 'h2' ? 'var(--q-lh-h2)' : undefined}
        fw={700}
        c={color}
        data-testid={testId}
      >
        {value}
        {unit && (
          <Text span inherit fw={500}>
            {'\u00a0'}
            {unit}
          </Text>
        )}
      </Text>
    </Stack>
  )
}
