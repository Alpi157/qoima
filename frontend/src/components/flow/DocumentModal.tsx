import { Button, Group, Modal, Stack, Text, type ModalProps } from '@mantine/core'
import { type ReactNode, useState } from 'react'
import { StatusContext } from './documentModalState'
import { useTranslation } from 'react-i18next'

/** All ways out of the modal share one guard; confirmation keeps the form mounted. */
export function DocumentModal({
  opened,
  onClose,
  children,
  invalidate,
  ...props
}: ModalProps & {
  children: ReactNode
  invalidate: () => void
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState({ unknown: false, busy: false })
  const [confirm, setConfirm] = useState(false)
  const [revision, setRevision] = useState(0)
  const [returnFocus, setReturnFocus] = useState(true)
  const finish = () => {
    invalidate()
    onClose()
  }
  const close = () => {
    if (status.busy) return
    if (status.unknown) setConfirm(true)
    else finish()
  }
  return (
    <Modal
      {...props}
      opened={opened}
      onClose={close}
      returnFocus={returnFocus}
      closeButtonProps={{ 'aria-label': t('flow.draft.close') }}
      onExitTransitionEnd={() => {
        setConfirm(false)
        setStatus({ unknown: false, busy: false })
        setReturnFocus(true)
      }}
    >
      {opened && (
        <StatusContext.Provider
          value={{
            setStatus,
            close,
            clear: () => {
              setRevision((value) => value + 1)
              setStatus({ unknown: false, busy: false })
            },
            openSaved: () => {
              setReturnFocus(false)
              finish()
            },
          }}
        >
          <div key={revision} hidden={confirm} style={{ display: confirm ? 'none' : 'contents' }}>
            {children}
          </div>
          {confirm && (
            <Stack gap="lg" role="alert">
              <Text>{t('flow.result.closeWarning')}</Text>
              <Group gap="sm" justify="flex-end">
                <Button variant="default" onClick={() => setConfirm(false)}>
                  {t('flow.result.keepOpen')}
                </Button>
                <Button
                  onClick={() => {
                    setConfirm(false)
                    finish()
                  }}
                >
                  {t('flow.draft.close')}
                </Button>
              </Group>
            </Stack>
          )}
        </StatusContext.Provider>
      )}
    </Modal>
  )
}
