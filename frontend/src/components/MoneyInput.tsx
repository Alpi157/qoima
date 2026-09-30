import { TextInput, type TextInputProps } from '@mantine/core'
import { useState } from 'react'

import { formatMoney, parseMoney, validateMoneyText } from '../lib/money'

export interface MoneyInputProps extends Omit<TextInputProps, 'value' | 'onChange'> {
  showHint?: boolean
  /** Text as typed, for example "12 500". */
  value?: string
  /** Receives the text and its value in tiyn (null when empty or invalid). */
  onChange: (value: string, tiyn: number | null) => void
}

// Keeps the hint's line when there is nothing to show, so the form does not jump while typing.
const EMPTY_HINT = '\u00a0'

// The hint goes under the input: fields next to each other stay aligned.
const WRAPPER_ORDER: ('label' | 'input' | 'description' | 'error')[] = [
  'label',
  'input',
  'description',
  'error',
]

/** Amount in tenge; the hint under the field shows how it was understood. */
export function MoneyInput({
  value = '',
  onChange,
  onBlur,
  error,
  showHint = true,
  ...props
}: MoneyInputProps) {
  const [touched, setTouched] = useState(false)
  const tiyn = parseMoney(value)
  const ownError = touched ? validateMoneyText(value) : null

  return (
    <TextInput
      inputMode="decimal"
      autoComplete="off"
      {...props}
      value={value}
      onChange={(event) => {
        const text = event.currentTarget.value
        onChange(text, parseMoney(text))
      }}
      onBlur={(event) => {
        setTouched(true)
        onBlur?.(event)
      }}
      inputWrapperOrder={showHint ? WRAPPER_ORDER : undefined}
      description={showHint ? (tiyn !== null ? formatMoney(tiyn) : EMPTY_HINT) : undefined}
      error={error || ownError}
    />
  )
}
