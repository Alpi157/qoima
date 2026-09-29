import { Alert, Button, Group, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

export interface DraftNoticeProps {
  /** «Аяқталмаған сатылым қалпына келтірілді.» */
  text: string
  /** «Тазарту»: drop the draft and start an empty document. */
  onClear: () => void
  onClose: () => void
}

/** The screen opened with an unfinished document from the last visit. */
export function DraftNotice({ text, onClear, onClose }: DraftNoticeProps) {
  const { t } = useTranslation()
  return (
    <Alert
      color="blue"
      variant="light"
      withCloseButton
      closeButtonLabel={t('flow.draft.close')}
      onClose={onClose}
      data-testid="draft-notice"
      role="status"
    >
      <Group justify="space-between" gap="md">
        <Text fw={600}>{text}</Text>
        <Button size="sm" variant="default" onClick={onClear}>
          {t('flow.draft.clear')}
        </Button>
      </Group>
    </Alert>
  )
}
