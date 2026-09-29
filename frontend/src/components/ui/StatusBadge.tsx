import { Badge } from '@mantine/core'
import type { ReactNode } from 'react'

export type StatusTone = 'posted' | 'cancelled' | 'archived'

const TONES: Record<StatusTone, { color: string; background: string }> = {
  posted: { color: 'var(--mantine-color-green-8)', background: 'var(--mantine-color-green-0)' },
  cancelled: { color: 'var(--mantine-color-red-6)', background: 'var(--mantine-color-red-0)' },
  archived: { color: 'var(--mantine-color-gray-7)', background: 'var(--mantine-color-gray-2)' },
}

/** Status of a document or product: caption 600, 28 high, radius 8, calm colors. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const { color, background } = TONES[tone]
  return (
    <Badge
      radius="sm"
      h={28}
      px="xs"
      fz="sm"
      fw={600}
      tt="none"
      c={color}
      bg={background}
      data-tone={tone}
    >
      {children}
    </Badge>
  )
}
