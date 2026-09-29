import { useTranslation } from 'react-i18next'

import { ConfirmModal } from '../ConfirmModal'

export interface CancelFlowModalProps {
  opened: boolean
  onClose: () => void
  onConfirm: () => void
  /** What is thrown away: «Таңдалған тауарлар мен сатып алушы өшіріледі.» */
  text: string
}

/** «Бас тарту» with lines on the screen: the draft is deleted only after a yes. */
export function CancelFlowModal({ opened, onClose, onConfirm, text }: CancelFlowModalProps) {
  const { t } = useTranslation()
  return (
    <ConfirmModal
      opened={opened}
      onClose={onClose}
      title={t('flow.cancelConfirm.title')}
      confirmLabel={t('flow.cancelConfirm.confirm')}
      color="red"
      onConfirm={onConfirm}
    >
      {text}
    </ConfirmModal>
  )
}
