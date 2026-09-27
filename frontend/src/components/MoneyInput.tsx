import { TextInput, type TextInputProps } from '@mantine/core'
import { useState } from 'react'

import { formatMoney, parseMoney, validateMoneyText } from '../lib/money'

export interface MoneyInputProps extends Omit<TextInputProps, 'value' | 'onChange'> {
  /** Text as typed, for example "12 500". */
  value?: string
  /** Receives the text and its value in tiyn (null when empty or invalid). */
  onChange: (value: string, tiyn: number | null) => void
}

/** Amount in tenge; the hint under the field shows how it was understood. */
export function MoneyInput({ value = '', onChange, onBlur, error, ...props }: MoneyInputProps) {
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
      description={tiyn !== null ? formatMoney(tiyn) : undefined}
      error={error || ownError}
    />
  )
}
