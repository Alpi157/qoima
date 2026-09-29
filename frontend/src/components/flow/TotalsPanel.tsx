import { Button, Card, Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface TotalsPanelProps {
  /** The main number, always on screen: the sum of a sale, the pieces of a receiving. */
  summary: ReactNode
  /** Other numbers (kinds, pieces): on a phone they are left out of the sticky panel. */
  children?: ReactNode
  /** The main button of the step, size lg. */
  actionLabel: string
  actionColor: 'green' | 'blue'
  onAction: () => void
  /** Why the main button cannot be pressed; null when it can. */
  blockedReason: string | null
  loading?: boolean
  /** Above the button: a failed save. */
  error?: ReactNode
  onCancel: () => void
}

/**
 * Right column of a flow: totals and the next step. On a phone it sticks to the bottom of the
 * screen with the main number and the button only; «Бас тарту» stands under the lines there
 * (flow.css).
 */
export function TotalsPanel({
  summary,
  children,
  actionLabel,
  actionColor,
  onAction,
  blockedReason,
  loading = false,
  error,
  onCancel,
}: TotalsPanelProps) {
  const { t } = useTranslation()
  return (
    <div className="flow-side">
      <Card className="flow-aside" component="aside" aria-label={t('flow.totals')}>
        <Stack gap="md">
          {children && <div className="flow-aside-details">{children}</div>}
          {summary}
          {error}
          <Stack gap="xs">
            <Button
              size="lg"
              color={actionColor}
              fullWidth
              onClick={onAction}
              disabled={blockedReason !== null}
              loading={loading}
              aria-describedby={blockedReason ? 'flow-blocked-reason' : undefined}
            >
              {actionLabel}
            </Button>
            {blockedReason && (
              <Text id="flow-blocked-reason" className="flow-hint-warning" fw={600}>
                {blockedReason}
              </Text>
            )}
          </Stack>
        </Stack>
      </Card>
      <Button variant="default" fullWidth onClick={onCancel} className="flow-cancel">
        {t('flow.cancel')}
      </Button>
    </div>
  )
}
