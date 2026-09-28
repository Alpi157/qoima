import { CloseButton, TextInput, type TextInputProps } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const SEARCH_DELAY_MS = 300

export interface SearchInputProps extends Omit<TextInputProps, 'value' | 'onChange'> {
  /** Current search from the address; the field follows it when it changes from outside (Back). */
  value: string
  /** Called 300 ms after the user stops typing. */
  onSearch: (value: string) => void
}

export function SearchInput({ value, onSearch, ...props }: SearchInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState(value)
  const [debounced] = useDebouncedValue(text, SEARCH_DELAY_MS)

  // The address changed without typing here (Back, a link): show that search.
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    if (value !== text.trim()) setText(value)
  }

  // Compare with the latest address value, but run only when the typed text settles:
  // a stale debounced value after Back must not overwrite the address.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    if (debounced.trim() !== valueRef.current) onSearch(debounced)
  }, [debounced, onSearch])

  return (
    <TextInput
      type="search"
      autoComplete="off"
      {...props}
      value={text}
      onChange={(event) => setText(event.currentTarget.value)}
      rightSection={
        text ? (
          <CloseButton
            aria-label={t('common.clearSearch')}
            onClick={() => {
              setText('')
              onSearch('')
            }}
          />
        ) : null
      }
    />
  )
}
