import { Button, Group, Stack } from '@mantine/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ChevronRightIcon } from './icons'
import { Card } from './ui'

/** The optional fields of a document, opened with «Қосымша». */
export function ExtraSection({
  id,
  opened,
  onToggle,
  children,
}: {
  id: string
  opened: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Stack gap="md">
      <Group>
        <Button
          variant="default"
          onClick={onToggle}
          aria-expanded={opened}
          aria-controls={id}
          leftSection={
            <span
              style={{
                display: 'inline-flex',
                transform: opened ? 'rotate(90deg)' : undefined,
                transition: 'transform var(--q-motion-press)',
              }}
            >
              <ChevronRightIcon size={20} />
            </span>
          }
        >
          {t('receive.extras.toggle')}
        </Button>
      </Group>
      {opened && (
        <Card id={id}>
          <Stack gap="lg">{children}</Stack>
        </Card>
      )}
    </Stack>
  )
}
