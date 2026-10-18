import { Alert, Button, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { ReceiptWarning } from '../receipts/api'
import type { ReceiptDraftExpense } from './receiptDraft'

import { receiptWarningText } from './receiptWarningText'

export function ReceiptWarnings({
  warnings,
  expenses,
  onFix,
}: {
  warnings: ReceiptWarning[]
  expenses: ReceiptDraftExpense[]
  onFix: (warning: ReceiptWarning) => void
}) {
  const { t } = useTranslation()
  if (!warnings.length) return null
  return (
    <Alert
      color="orange"
      styles={{
        root: {
          background: 'var(--q-color-warning-bg)',
          border: '1px solid var(--q-color-warning-border)',
        },
        title: { color: 'var(--q-color-warning-text)' },
        message: { color: 'var(--q-color-warning-text)' },
      }}
      role="alert"
      data-testid="receipt-warnings"
      id="receipt-warnings-block"
      title={<Title order={3}>{t('receive.warnings.title')}</Title>}
    >
      <Stack gap="md">
        {warnings.map((warning) => (
          <Stack gap="xs" key={warning.key}>
            <Text style={{ overflowWrap: 'anywhere' }}>
              {warning.code === 'rate_deviation' &&
                warning.params.target === 'expense' &&
                expenses[warning.params.index ?? -1] && (
                  <>{t(`receive.expenses.${expenses[warning.params.index!].kind}`)}: </>
                )}
              {receiptWarningText(warning, t)}
            </Text>
            <Button
              variant="default"
              onClick={() => onFix(warning)}
              style={{ alignSelf: 'flex-start' }}
            >
              {t('receive.warnings.fix')}
            </Button>
          </Stack>
        ))}
      </Stack>
    </Alert>
  )
}
