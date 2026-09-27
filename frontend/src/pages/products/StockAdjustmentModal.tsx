import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { useMutation } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'

import { api, unwrap } from '../../api/client'
import { isApiError, isClientError } from '../../api/errors'
import { useInvalidateStock } from '../../api/invalidate'
import type { components } from '../../api/schema'
import {
  MAX_LINE_QTY,
  QTY_ERROR,
  qtyError,
  reasonError as validateReason,
} from '../../lib/validation'
import type { Product } from './api'

type AdjustmentCreate = components['schemas']['AdjustmentCreate']
type Direction = 'add' | 'remove'

const DIRECTIONS = [
  { value: 'add', label: 'Добавить' },
  { value: 'remove', label: 'Списать' },
]

const QUICK_REASONS = ['Пересчёт', 'Брак', 'Потеря']

function useCreateAdjustment() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (body: AdjustmentCreate) => unwrap(api.POST('/api/stock/adjustments', { body })),
    onSuccess: invalidate,
  })
}

interface AdjustmentFormProps {
  product: Product
  onDone: () => void
}

function AdjustmentForm({ product, onDone }: AdjustmentFormProps) {
  const create = useCreateAdjustment()
  const [direction, setDirection] = useState<Direction>('add')
  const [qty, setQty] = useState<number | string>(1)
  const [reason, setReason] = useState('')
  const [qtyTouched, setQtyTouched] = useState(false)
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const qtyProblem = qtyError(qty)
  const delta = qtyProblem === null ? (direction === 'add' ? 1 : -1) * (qty as number) : 0
  const after = product.stock + delta

  const submit = () => {
    setQtyTouched(true)
    const reasonProblem = validateReason(reason)
    setReasonError(reasonProblem)
    if (qtyProblem || reasonProblem) return
    setFormError(null)
    create.mutate(
      { product_id: product.id, qty: delta, reason: reason.trim() },
      {
        onSuccess: (result) => {
          notifications.show({
            color: 'green',
            message: `Остаток ${product.article}: ${result.stock} ${product.unit}`,
          })
          onDone()
        },
        onError: (error) => {
          // 409 (stock would go negative) and other 4xx stay in the window.
          if (!isClientError(error) || !isApiError(error)) return
          if (error.fieldErrors.reason) setReasonError(error.fieldErrors.reason)
          else setFormError(error.detail)
        },
      },
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      noValidate
    >
      <Stack>
        <SegmentedControl
          aria-label="Действие"
          data={DIRECTIONS}
          value={direction}
          onChange={(value) => {
            setDirection(value as Direction)
            setFormError(null)
          }}
          color={direction === 'add' ? 'green' : 'red'}
          fullWidth
        />
        <NumberInput
          label="Количество"
          required
          data-autofocus
          value={qty}
          onChange={(value) => {
            setQty(value)
            setFormError(null)
          }}
          onBlur={() => setQtyTouched(true)}
          min={1}
          max={MAX_LINE_QTY}
          allowDecimal={false}
          allowNegative={false}
          clampBehavior="none"
          error={qtyTouched && qtyProblem ? QTY_ERROR : null}
        />
        <Stack gap={6}>
          <TextInput
            label="Причина"
            required
            autoComplete="off"
            value={reason}
            onChange={(event) => {
              setReason(event.currentTarget.value)
              setReasonError(null)
            }}
            error={reasonError}
          />
          <Group gap="xs">
            {QUICK_REASONS.map((quick) => (
              <Button
                key={quick}
                size="compact-sm"
                variant={reason === quick ? 'filled' : 'default'}
                onClick={() => {
                  setReason(quick)
                  setReasonError(null)
                }}
              >
                {quick}
              </Button>
            ))}
          </Group>
        </Stack>

        <Text>
          Сейчас: {product.stock} {product.unit} → станет:{' '}
          <Text span fw={700} c={after < 0 ? 'red' : undefined}>
            {after} {product.unit}
          </Text>
        </Text>

        {formError && (
          <Alert color="red" role="alert">
            {formError}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onDone} disabled={create.isPending}>
            Отмена
          </Button>
          <Button
            type="submit"
            loading={create.isPending}
            color={direction === 'add' ? undefined : 'red'}
          >
            {direction === 'add' ? 'Добавить' : 'Списать'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export interface StockAdjustmentModalProps {
  product: Product
  opened: boolean
  onClose: () => void
}

export function StockAdjustmentModal({ product, opened, onClose }: StockAdjustmentModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={`Корректировка остатка: ${product.article}`}>
      {/* Mounted only while open, so every adjustment starts from a clean form. */}
      {opened && <AdjustmentForm product={product} onDone={onClose} />}
    </Modal>
  )
}
