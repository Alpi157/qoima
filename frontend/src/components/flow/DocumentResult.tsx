import { Alert, Button, Group, Stack, Text, Title } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { type ApiError } from '../../api/errors'

export function UnknownResult({
  onRetry,
  busy = false,
  disabled = false,
}: {
  onRetry: () => void
  busy?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const block = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!busy) block.current?.scrollIntoView({ block: 'center' })
  }, [busy])
  return (
    <Alert
      ref={block}
      color="blue"
      role="status"
      title={<Title order={3}>{t('flow.result.title')}</Title>}
      data-testid="unknown-result"
    >
      <Stack gap="md">
        <Text>{t('flow.result.description')}</Text>
        <Button
          onClick={onRetry}
          loading={busy}
          disabled={disabled}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('flow.result.retry')}
        </Button>
      </Stack>
    </Alert>
  )
}

export function RequestConflictAlert({
  error,
  onClear,
  onOpen,
  customerId,
}: {
  error: ApiError
  onClear: () => void
  onOpen?: () => void
  customerId?: number
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const open = () => {
    let pathname: string
    const search = new URLSearchParams(location.search)
    if (error.code === 'expense_request_conflict') {
      pathname = '/expenses'
      search.set('expenseFocus', String(error.params.id))
    } else if (error.code === 'stock_adjustment_request_conflict') {
      pathname = `/products/${String(error.params.product_id)}`
      search.set('movementFocus', String(error.params.movement_id))
    } else if (
      error.code === 'payment_request_conflict' ||
      error.code === 'debt_adjustment_request_conflict'
    ) {
      pathname = `/customers/${customerId}`
      search.set(
        'ledgerFocus',
        `${error.code === 'payment_request_conflict' ? 'payment' : 'adjustment'}:${String(error.params.id)}`,
      )
    } else {
      const path =
        error.code === 'sale_request_conflict'
          ? 'sales'
          : error.code === 'receipt_request_conflict'
            ? 'receipts'
            : 'returns'
      pathname = `/${path}/${String(error.params.id)}`
    }
    void queryClient.invalidateQueries()
    onOpen?.()
    navigate({
      pathname,
      search:
        pathname === location.pathname ||
        customerId !== undefined ||
        error.code === 'stock_adjustment_request_conflict' ||
        error.code === 'expense_request_conflict'
          ? search.toString()
          : '',
    })
  }
  return (
    <Alert color="orange" role="alert" data-testid="request-conflict">
      <Stack gap="md">
        <Text>
          {error.code === 'stock_adjustment_request_conflict'
            ? t('flow.result.stockConflict')
            : t('flow.result.conflict', { number: error.params.number })}
        </Text>
        <Group gap="sm">
          <Button variant="default" onClick={open}>
            {t('flow.result.open')}
          </Button>
          <Button variant="default" onClick={onClear}>
            {t('flow.draft.clear')}
          </Button>
        </Group>
      </Stack>
    </Alert>
  )
}
