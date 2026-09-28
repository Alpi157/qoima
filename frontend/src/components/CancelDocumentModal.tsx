import { Alert, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { UseMutationResult } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isApiError, isClientError } from '../api/errors'
import { apiErrorText, fieldErrorText } from '../i18n/errorText'
import { reasonError as validateReason } from '../lib/validation'

export interface CancelDocumentModalProps<T> {
  opened: boolean
  onClose: () => void
  /** For example "Отменить приход №12?". */
  title: string
  /** What the cancellation does to stock. */
  description: string
  /** Label of the confirm button, for example "Отменить приход". */
  confirmLabel: string
  /** The cancel mutation; it receives the reason. */
  cancel: UseMutationResult<T, Error, string>
  /** Notification after a successful cancellation. */
  successMessage: (cancelled: T) => string
}

/** Cancellation of a posted document with a required reason. */
export function CancelDocumentModal<T>({
  opened,
  onClose,
  title,
  description,
  confirmLabel,
  cancel,
  successMessage,
}: CancelDocumentModalProps<T>) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const close = () => {
    setReason('')
    setReasonError(null)
    setFormError(null)
    onClose()
  }

  const submit = () => {
    const problem = validateReason(reason)
    if (problem) {
      setReasonError(problem)
      return
    }
    setFormError(null)
    cancel.mutate(reason.trim(), {
      onSuccess: (cancelled) => {
        notifications.show({ color: 'green', message: successMessage(cancelled) })
        close()
      },
      onError: (error) => {
        // 409 (for example stock would go negative) and other 4xx stay in the window;
        // 5xx is a notification.
        if (!isClientError(error) || !isApiError(error)) return
        const reasonProblem = error.fieldErrors.reason
        if (reasonProblem) setReasonError(fieldErrorText(reasonProblem, 'reason', t))
        else setFormError(apiErrorText(error, t))
      },
    })
  }

  return (
    <Modal opened={opened} onClose={close} title={title}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        noValidate
      >
        <Stack>
          <Text size="sm">{description}</Text>
          <Textarea
            label={t('common.cancelDocument.reason')}
            required
            autosize
            minRows={2}
            data-autofocus
            value={reason}
            onChange={(event) => {
              setReason(event.currentTarget.value)
              setReasonError(null)
            }}
            error={reasonError}
          />
          {formError && (
            <Alert color="red" role="alert">
              {formError}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close} disabled={cancel.isPending}>
              {t('common.cancelDocument.keep')}
            </Button>
            <Button type="submit" color="red" loading={cancel.isPending}>
              {confirmLabel}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
