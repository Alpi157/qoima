import { Button, Group, Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { TrashIcon } from '../icons'
import { Card } from '../ui'

export interface LineCardProps {
  article: string
  name: string
  onRemove: () => void
  /** Quantity (QtyStepper) and, for a sale, the price field. */
  children: ReactNode
  /** The line sum, for a sale: a row of its own, on the right. */
  sum?: ReactNode
  /** Under the fields: «Қазір: 5 дана. Қабылдағаннан кейін: 7 дана.» */
  hint?: ReactNode
  /** What to fix: the card gets an orange border and this text in a strip. */
  warning?: string | null
}

/** One line of a document being filled in. */
export function LineCard({ article, name, onRemove, children, sum, hint, warning }: LineCardProps) {
  const { t } = useTranslation()
  return (
    <Card className="flow-line" data-warning={warning ? true : undefined} data-testid="flow-line">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
          <Stack gap={4} miw={0} style={{ flex: 1 }}>
            <Text className="flow-article">{article}</Text>
            <Text c="dimmed">{name}</Text>
          </Stack>
          <Button
            variant="default"
            size="sm"
            leftSection={<TrashIcon size={20} />}
            onClick={onRemove}
            aria-label={t('flow.removeOf', { article })}
            styles={{ label: { whiteSpace: 'nowrap' } }}
          >
            {t('flow.remove')}
          </Button>
        </Group>
        <Group align="flex-start" gap="lg">
          {children}
        </Group>
        {sum}
        {hint}
      </Stack>
      {warning && (
        <div className="flow-warning" role="status">
          {warning}
        </div>
      )}
    </Card>
  )
}
