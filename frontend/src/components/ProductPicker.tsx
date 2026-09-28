import { Combobox, Group, Loader, Stack, Text, TextInput, useCombobox } from '@mantine/core'
import { useDebouncedValue, useMergedRef } from '@mantine/hooks'
import { type Ref, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { unitLabel } from '../lib/labels'
import { formatMoney } from '../lib/money'
import { type Product, useProductSearch } from '../pages/products/api'
import { ProductFormModal } from '../pages/products/ProductFormModal'
import { SEARCH_DELAY_MS } from './SearchInput'

// Option value of "create product …"; real options use product ids.
const CREATE_OPTION = 'create'

export interface ProductPickerProps {
  /** Receives the chosen (or just created) product; the field is cleared for the next one. */
  onSelect: (product: Product) => void
  /** The input, so the page can return focus here (for example after Enter in a quantity). */
  ref?: Ref<HTMLInputElement>
  autoFocus?: boolean
  label?: string
  /** Defaults to "Артикул или название" in the current language. */
  placeholder?: string
}

function ProductOption({ product }: { product: Product }) {
  const { t } = useTranslation()
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="lg" fw={700} style={{ wordBreak: 'break-all' }}>
          {product.article}
        </Text>
        <Text size="sm">{product.name}</Text>
      </Stack>
      <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
        <Text size="sm" c={product.stock <= 0 ? 'red' : 'dimmed'}>
          {t('products.picker.stock', { stock: `${product.stock} ${unitLabel(product.unit)}` })}
        </Text>
        <Text size="sm" fw={500}>
          {formatMoney(product.sale_price)}
        </Text>
      </Stack>
    </Group>
  )
}

/** Search by article or name; arrows and Enter pick a product, Esc closes the list. */
export function ProductPicker({
  onSelect,
  ref,
  autoFocus,
  label,
  placeholder,
}: ProductPickerProps) {
  const { t } = useTranslation()
  const combobox = useCombobox()
  const inputRef = useRef<HTMLInputElement>(null)
  const mergedRef = useMergedRef(inputRef, ref)
  const [text, setText] = useState('')
  const [debounced] = useDebouncedValue(text, SEARCH_DELAY_MS)
  const [createArticle, setCreateArticle] = useState<string | null>(null)
  const search = useProductSearch(debounced)

  const query = debounced.trim()
  const items = query && search.data ? search.data.items : []
  // Offer creation only when the answer is for exactly this text, not a previous search.
  const nothingFound =
    query !== '' && search.isSuccess && !search.isPlaceholderData && items.length === 0
  const settled = text.trim() === query

  // New results or new text: highlight the first option, so Enter picks it right away.
  // The text matters too: typing the same search again gets cached data, which does not change.
  useEffect(() => {
    combobox.selectFirstOption()
    // combobox is a new object every render; only the list and the text matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.data, nothingFound, text])

  const choose = (product: Product) => {
    setText('')
    combobox.closeDropdown()
    combobox.resetSelectedOption()
    onSelect(product)
  }

  const handleOptionSubmit = (value: string) => {
    if (value === CREATE_OPTION) {
      combobox.closeDropdown()
      setCreateArticle(text.trim())
      return
    }
    const product = items.find((item) => String(item.id) === value)
    if (product) choose(product)
  }

  const closeCreate = () => {
    setCreateArticle(null)
    inputRef.current?.focus()
  }

  return (
    <>
      <Combobox store={combobox} onOptionSubmit={handleOptionSubmit}>
        <Combobox.Target>
          <TextInput
            ref={mergedRef}
            type="search"
            autoComplete="off"
            autoFocus={autoFocus}
            label={label}
            aria-label={label ? undefined : t('products.list.searchLabel')}
            placeholder={placeholder ?? t('products.list.searchPlaceholder')}
            value={text}
            onChange={(event) => {
              const value = event.currentTarget.value
              setText(value)
              if (value.trim()) combobox.openDropdown()
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
          <Combobox.Options mah={400} style={{ overflowY: 'auto' }}>
            {items.map((product) => (
              <Combobox.Option key={product.id} value={String(product.id)}>
                <ProductOption product={product} />
              </Combobox.Option>
            ))}
            {nothingFound && settled && (
              <Combobox.Option value={CREATE_OPTION}>
                <Text fw={500} c="blue">
                  {t('products.picker.create', { article: query })}
                </Text>
              </Combobox.Option>
            )}
            {items.length === 0 && !(nothingFound && settled) && (
              <Combobox.Empty>{t('common.searching')}</Combobox.Empty>
            )}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>

      <ProductFormModal
        opened={createArticle !== null}
        initialArticle={createArticle ?? ''}
        withAddMore={false}
        onClose={closeCreate}
        onSaved={choose}
      />
    </>
  )
}
