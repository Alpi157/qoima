import {
  CloseButton,
  Combobox,
  Group,
  Input,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  useCombobox,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { type Customer, useCustomerSearch } from '../pages/customers/api'
import { CustomerFormModal } from '../pages/customers/CustomerFormModal'
import { SEARCH_DELAY_MS } from './SearchInput'

// Option value of "create customer …"; real options use customer ids.
const CREATE_OPTION = 'create'

/** What the picker needs to show a chosen customer; a full Customer or a sale's customer fits. */
export interface PickedCustomer {
  id: number
  name: string
  phone: string | null
}

export interface CustomerPickerProps {
  value: PickedCustomer | null
  /** Receives the chosen (or just created) customer, or null when the choice is reset. */
  onChange: (customer: PickedCustomer | null) => void
  /** Defaults to "Покупатель" in the current language. */
  label?: string
  /** Offer "create customer …" when nothing is found. */
  allowCreate?: boolean
}

function CustomerOption({ customer }: { customer: Customer }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text fw={600}>{customer.name}</Text>
      {customer.phone && (
        <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          {customer.phone}
        </Text>
      )}
    </Group>
  )
}

/** Search by name or phone; arrows and Enter pick a customer, Esc closes the list. */
export function CustomerPicker({
  value,
  onChange,
  label,
  allowCreate = true,
}: CustomerPickerProps) {
  const { t } = useTranslation()
  const fieldLabel = label ?? t('customers.picker.label')
  const combobox = useCombobox()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [debounced] = useDebouncedValue(text, SEARCH_DELAY_MS)
  const [createName, setCreateName] = useState<string | null>(null)
  const search = useCustomerSearch(debounced)

  const query = debounced.trim()
  const items = query && search.data ? search.data.items : []
  // Offer creation only when the answer is for exactly this text, not a previous search.
  const nothingFound =
    query !== '' && search.isSuccess && !search.isPlaceholderData && items.length === 0
  const settled = text.trim() === query
  const offerCreate = allowCreate && nothingFound && settled

  // New results or new text: highlight the first option, so Enter picks it right away.
  useEffect(() => {
    combobox.selectFirstOption()
    // combobox is a new object every render; only the list and the text matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.data, nothingFound, text])

  const choose = (customer: Customer) => {
    setText('')
    combobox.closeDropdown()
    combobox.resetSelectedOption()
    onChange(customer)
  }

  const handleOptionSubmit = (option: string) => {
    if (option === CREATE_OPTION) {
      combobox.closeDropdown()
      setCreateName(text.trim())
      return
    }
    const customer = items.find((item) => String(item.id) === option)
    if (customer) choose(customer)
  }

  const reset = () => {
    // Render the search field first, so it can take the focus.
    flushSync(() => onChange(null))
    inputRef.current?.focus()
  }

  const modal = (
    <CustomerFormModal
      opened={createName !== null}
      initialName={createName ?? ''}
      onClose={() => setCreateName(null)}
      onSaved={choose}
    />
  )

  if (value) {
    return (
      <>
        <Input.Wrapper label={fieldLabel}>
          <Paper withBorder px="md" py="xs" radius="md" mih="var(--q-control-md)">
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text fw={600}>{value.name}</Text>
                {value.phone && (
                  <Text size="sm" c="dimmed">
                    {value.phone}
                  </Text>
                )}
              </Stack>
              <CloseButton aria-label={t('customers.picker.reset')} onClick={reset} />
            </Group>
          </Paper>
        </Input.Wrapper>
        {modal}
      </>
    )
  }

  return (
    <>
      <Combobox store={combobox} onOptionSubmit={handleOptionSubmit}>
        <Combobox.Target>
          <TextInput
            ref={inputRef}
            type="search"
            autoComplete="off"
            label={fieldLabel}
            placeholder={t('customers.picker.placeholder')}
            value={text}
            onChange={(event) => {
              const next = event.currentTarget.value
              setText(next)
              if (next.trim()) combobox.openDropdown()
              else combobox.closeDropdown()
            }}
            onFocus={() => {
              if (text.trim()) combobox.openDropdown()
            }}
            onBlur={() => combobox.closeDropdown()}
            rightSection={search.isFetching ? <Loader size="xs" /> : null}
          />
        </Combobox.Target>

        <Combobox.Dropdown hidden={!text.trim()}>
          <Combobox.Options mah={300} style={{ overflowY: 'auto' }}>
            {items.map((customer) => (
              <Combobox.Option key={customer.id} value={String(customer.id)}>
                <CustomerOption customer={customer} />
              </Combobox.Option>
            ))}
            {offerCreate && (
              <Combobox.Option value={CREATE_OPTION}>
                <Text fw={600} c="blue">
                  {t('customers.picker.create', { name: query })}
                </Text>
              </Combobox.Option>
            )}
            {items.length === 0 && !offerCreate && (
              <Combobox.Empty>
                {nothingFound && settled ? t('common.notFoundShort') : t('common.searching')}
              </Combobox.Empty>
            )}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
      {modal}
    </>
  )
}
