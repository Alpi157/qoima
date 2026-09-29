import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface ConfirmModalProps {
  opened: boolean
  onClose: () => void
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  loading?: boolean
  color?: string
}

/** A yes/no question before an action that changes data. */
export function ConfirmModal({
  opened,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  loading = false,
  color,
}: ConfirmModalProps) {
  const { t } = useTranslation()
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack>
        <Text>{children}</Text>
        <Group justify="flex-end" gap="sm" className="q-modal-actions">
          <Button variant="default" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button color={color} onClick={onConfirm} loading={loading} data-autofocus>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
