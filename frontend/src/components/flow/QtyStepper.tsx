import { Button, Group, NumberInput, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { MAX_LINE_QTY } from '../../lib/validation'
import { MinusIcon, PlusIcon } from '../icons'

export interface QtyStepperProps {
  /** A number, or '' while the field is empty (that is a quantity to fix, not 0 items). */
  value: number | string
  onChange: (value: number | string) => void
  /** «IKH16TT саны»: which line the field belongs to. */
  label: string
  unit: string
}

/** «−», the quantity and «+»: square 56x56 buttons around a 120 wide field. */
export function QtyStepper({ value, onChange, label, unit }: QtyStepperProps) {
  const { t } = useTranslation()
  const qty = typeof value === 'number' ? value : 0
  return (
    <Group gap="xs" wrap="nowrap">
      <Button
        variant="default"
        className="flow-qty-button"
        aria-label={t('flow.decrease')}
        disabled={qty <= 1}
        onClick={() => onChange(Math.max(1, qty - 1))}
      >
        <MinusIcon />
      </Button>
      <NumberInput
        aria-label={label}
        value={value}
        onChange={onChange}
        min={1}
        max={MAX_LINE_QTY}
        allowDecimal={false}
        allowNegative={false}
        clampBehavior="none"
        hideControls
        w={FIELD_WIDTH.qty}
        styles={{ input: { textAlign: 'center' } }}
      />
      <Button
        variant="default"
        className="flow-qty-button"
        aria-label={t('flow.increase')}
        disabled={qty >= MAX_LINE_QTY}
        onClick={() => onChange(qty + 1)}
      >
        <PlusIcon />
      </Button>
      <Text>{unit}</Text>
    </Group>
  )
}
